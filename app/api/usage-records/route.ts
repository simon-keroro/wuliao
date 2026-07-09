import type { UsageInput } from "@/lib/materials";
import { jsonError, requirePermission } from "@/lib/server/http";
import { createUsageRecord, logAudit } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requirePermission(request, "usage:create");
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json()) as UsageInput;
    const state = createUsageRecord(payload);
    logAudit(user, "usage.create", payload.materialBatchId ?? "", {
      userName: payload.userName ?? "",
      quantity: payload.usedQuantity ?? "",
    });
    return Response.json(state, { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}
