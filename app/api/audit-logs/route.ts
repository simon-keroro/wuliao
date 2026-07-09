import { jsonError, requirePermission } from "@/lib/server/http";
import { listAuditLogs, logAudit } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = requirePermission(request, "audit:read");
  if (user instanceof Response) return user;

  try {
    const logs = listAuditLogs(user, true);
    logAudit(user, "audit.view", "all-users", {});
    return Response.json({ logs, scope: "all" });
  } catch (error) {
    return jsonError(error);
  }
}
