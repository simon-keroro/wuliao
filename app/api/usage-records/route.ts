import type { UsageInput } from "@/lib/materials";
import { jsonError, requirePermission } from "@/lib/server/http";
import {
  createUsageRecord,
  deleteUsageRecord,
  issueUsageRecord,
  logAudit,
  undoIssueUsageRecord,
} from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requirePermission(request, "usage:create");
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json()) as UsageInput;
    const state = createUsageRecord(payload, user);
    logAudit(user, "usage.create", payload.materialBatchId ?? "", {
      userName: payload.userName ?? "",
      quantity: payload.usedQuantity ?? "",
    });
    return Response.json(state, { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}

export async function PATCH(request: Request) {
  const user = requirePermission(request, "usage:process");
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json()) as { id?: string; action?: string };
    if (payload.action === "issue") {
      const state = issueUsageRecord(payload.id ?? "", user);
      logAudit(user, "usage.issue", payload.id ?? "", {});
      return Response.json(state);
    }
    if (payload.action === "undoIssue") {
      const state = undoIssueUsageRecord(payload.id ?? "");
      logAudit(user, "usage.undoIssue", payload.id ?? "", {});
      return Response.json(state);
    }
    throw new Error("不支持的出库操作。");
  } catch (error) {
    return jsonError(error, 400);
  }
}

export async function DELETE(request: Request) {
  const user = requirePermission(request, "usage:create");
  if (user instanceof Response) return user;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    const state = deleteUsageRecord(id, user);
    logAudit(user, "usage.delete", id, {});
    return Response.json(state);
  } catch (error) {
    return jsonError(error, 400);
  }
}
