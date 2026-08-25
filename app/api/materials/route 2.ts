import type { MaterialInput, MaterialUpdateInput } from "@/lib/materials";
import { jsonError, requireAuth } from "@/lib/server/http";
import { createMaterial, deleteMaterial, updateMaterial } from "@/lib/server/store";

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

export async function PUT(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const payload = (await request.json()) as MaterialUpdateInput;
    return Response.json(updateMaterial(payload));
  } catch (error) {
    return jsonError(error, 400);
  }
}

export async function DELETE(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    return Response.json(deleteMaterial(url.searchParams.get("id") ?? ""));
  } catch (error) {
    return jsonError(error, 400);
  }
}
