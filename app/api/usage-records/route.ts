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

function usageAuditDetails(record: {
  userName: string;
  materialName: string;
  usedQuantity: number;
  unit: string;
  purpose: string;
  sapNo: string;
  batchNo: string;
}) {
  return {
    userName: record.userName,
    materialName: record.materialName,
    quantity: record.usedQuantity,
    unit: record.unit || "个",
    purpose: record.purpose,
    sapNo: record.sapNo,
    batchNo: record.batchNo,
  };
}

export async function POST(request: Request) {
  const user = requirePermission(request, "usage:create");
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json()) as UsageInput;
    const result = createUsageRecord(payload, user);
    logAudit(user, "usage.create", result.record.id, usageAuditDetails(result.record));
    return Response.json(result.state, { status: 201 });
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
      const result = issueUsageRecord(payload.id ?? "", user);
      logAudit(user, "usage.issue", result.record.id, usageAuditDetails(result.record));
      return Response.json(result.state);
    }
    if (payload.action === "undoIssue") {
      const result = undoIssueUsageRecord(payload.id ?? "");
      logAudit(user, "usage.undoIssue", result.record.id, usageAuditDetails(result.record));
      return Response.json(result.state);
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
    const result = deleteUsageRecord(id, user);
    logAudit(user, "usage.delete", result.record.id, usageAuditDetails(result.record));
    return Response.json(result.state);
  } catch (error) {
    return jsonError(error, 400);
  }
}
