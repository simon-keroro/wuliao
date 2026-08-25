import { getInventoryState } from "@/lib/server/store";
import { jsonError, requireAuth } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    return Response.json(getInventoryState());
  } catch (error) {
    return jsonError(error);
  }
}
