import { jsonError, requirePermission } from "@/lib/server/http";
import { logAudit, restoreDemoState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requirePermission(request, "demo:reset");
  if (user instanceof Response) return user;

  try {
    const state = restoreDemoState();
    logAudit(user, "demo.reset", "inventory", {});
    return Response.json(state);
  } catch (error) {
    return jsonError(error);
  }
}
