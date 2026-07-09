import { getInventoryState } from "@/lib/server/store";
import { jsonError, requirePermission } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = requirePermission(request, "inventory:read");
  if (user instanceof Response) return user;

  try {
    return Response.json(getInventoryState());
  } catch (error) {
    return jsonError(error);
  }
}
