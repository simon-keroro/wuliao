import type { ReservationInput } from "@/lib/materials";
import { jsonError, requirePermission } from "@/lib/server/http";
import {
  createReservation,
  deleteReservation,
  logAudit,
  receiveReservation,
  undoReceiveReservation,
} from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requirePermission(request, "reservation:create");
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json()) as ReservationInput;
    const state = createReservation(payload);
    logAudit(user, "reservation.create", payload.materialName ?? "", { requester: payload.requester ?? "" });
    return Response.json(state, { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}

export async function PATCH(request: Request) {
  const user = requirePermission(request, "reservation:process");
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json()) as { id?: string; action?: string };
    if (payload.action === "receive") {
      const state = receiveReservation(payload.id ?? "");
      logAudit(user, "reservation.receive", payload.id ?? "", {});
      return Response.json(state);
    }
    if (payload.action === "undoReceive") {
      const state = undoReceiveReservation(payload.id ?? "");
      logAudit(user, "reservation.undoReceive", payload.id ?? "", {});
      return Response.json(state);
    }
    throw new Error("不支持的预约操作。");
  } catch (error) {
    return jsonError(error, 400);
  }
}

export async function DELETE(request: Request) {
  const user = requirePermission(request, "reservation:delete");
  if (user instanceof Response) return user;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    const state = deleteReservation(id);
    logAudit(user, "reservation.delete", id, {});
    return Response.json(state);
  } catch (error) {
    return jsonError(error, 400);
  }
}
