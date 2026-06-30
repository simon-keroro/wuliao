import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "materials_session";
const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

function getSessionSecret() {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || "local-development-secret";
}

function getExpectedPassword() {
  return process.env.APP_PASSWORD ?? "";
}

function signSession() {
  return createHmac("sha256", getSessionSecret()).update("materials-shared-session").digest("base64url");
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

export function validatePassword(password: string) {
  const expected = getExpectedPassword();
  if (!expected) {
    throw new Error("服务器尚未设置 APP_PASSWORD，不能登录。");
  }
  return safeEqual(password, expected);
}

export function isAuthenticated(request: Request) {
  return safeEqual(readCookie(request, COOKIE_NAME), signSession());
}

export function sessionCookie() {
  return `${COOKIE_NAME}=${encodeURIComponent(signSession())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_WEEK_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
