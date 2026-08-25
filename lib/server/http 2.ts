import { isAuthenticated } from "@/lib/server/auth";

export function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "服务器处理失败。";
  return Response.json({ error: message }, { status });
}

export function requireAuth(request: Request) {
  if (isAuthenticated(request)) return null;
  return Response.json({ error: "请先登录。" }, { status: 401 });
}
