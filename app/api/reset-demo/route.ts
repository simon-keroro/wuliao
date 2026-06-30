import { jsonError, requireAuth } from "@/lib/server/http";
import { restoreDemoState } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    return Response.json(restoreDemoState());
  } catch (error) {
    return jsonError(error);
  }
}
