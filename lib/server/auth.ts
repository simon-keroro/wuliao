import { createHmac, timingSafeEqual } from "node:crypto";
import type { CurrentUser } from "@/lib/materials";
import { getCurrentUserById } from "@/lib/server/store";

const COOKIE_NAME = "materials_session";
const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

function getSessionSecret() {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || "local-development-secret";
}

function signSession(userId: string) {
  return createHmac("sha256", getSessionSecret()).update(`materials-user-session:${userId}`).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  const pairs = header.split(";").map((part) => part.trim());
  for (const pair of pairs) {
    const [key, ...valueParts] = pair.split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return "";
}

function readSession(request: Request) {
  const value = readCookie(request, COOKIE_NAME);
  const [userId, signature] = value.split(".");
  if (!userId || !signature) return null;
  if (!safeEqual(signature, signSession(userId))) return null;
  return userId;
}

export function getCurrentUser(request: Request): CurrentUser | null {
  const userId = readSession(request);
  if (!userId) return null;
  return getCurrentUserById(userId);
}

export function isAuthenticated(request: Request) {
  return Boolean(getCurrentUser(request));
}

export function sessionCookie(user: CurrentUser) {
  const value = `${user.id}.${signSession(user.id)}`;
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_WEEK_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
