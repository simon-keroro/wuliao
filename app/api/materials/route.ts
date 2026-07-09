import type { MaterialInput, MaterialUpdateInput } from "@/lib/materials";
import { jsonError, requirePermission } from "@/lib/server/http";
import { createMaterial, deleteMaterial, logAudit, updateMaterial } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requirePermission(request, "inventory:write");
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json()) as MaterialInput;
    const state = createMaterial(payload);
    logAudit(user, "material.create", payload.name ?? "", { sapNo: payload.sapNo ?? "" });
    return Response.json(state, { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}

export async function PUT(request: Request) {
  const user = requirePermission(request, "inventory:write");
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json()) as MaterialUpdateInput;
    const state = updateMaterial(payload);
    logAudit(user, "material.update", payload.id ?? "", { name: payload.name ?? "" });
    return Response.json(state);
  } catch (error) {
    return jsonError(error, 400);
  }
}

export async function DELETE(request: Request) {
  const user = requirePermission(request, "inventory:delete");
  if (user instanceof Response) return user;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    const state = deleteMaterial(id);
    logAudit(user, "material.delete", id, {});
    return Response.json(state);
  } catch (error) {
    return jsonError(error, 400);
  }
}
