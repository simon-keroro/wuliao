import type { MaterialInput } from "@/lib/materials";
import { jsonError, requireAuth } from "@/lib/server/http";
import { createMaterial } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const payload = (await request.json()) as MaterialInput;
    return Response.json(createMaterial(payload), { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}
