import type { CurrentUser } from "@/lib/materials";
import type { Permission } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { getCurrentUser, isAuthenticated } from "@/lib/server/auth";

export function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "服务器处理失败。";
  return Response.json({ error: message }, { status });
}

export function requireAuth(request: Request) {
  if (isAuthenticated(request)) return null;
  return Response.json({ error: "请先登录。" }, { status: 401 });
}

export function requireUser(request: Request): CurrentUser | Response {
  const user = getCurrentUser(request);
  if (user) return user;
  return Response.json({ error: "请先登录。" }, { status: 401 });
}

export function requirePermission(request: Request, permission: Permission): CurrentUser | Response {
  const user = getCurrentUser(request);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (!can(user.role, permission)) return Response.json({ error: "当前账号没有此操作权限。" }, { status: 403 });
  return user;
}
