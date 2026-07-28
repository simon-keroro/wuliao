import type { ReservationInput } from "@/lib/materials";
import { jsonError, requireAuth } from "@/lib/server/http";
import {
  createReservation,
  createReservations,
  deleteReservation,
  receiveReservation,
  undoReceiveReservation,
} from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const payload = (await request.json()) as ReservationInput | { reservations?: ReservationInput[] };
    if ("reservations" in payload && Array.isArray(payload.reservations)) {
      return Response.json(createReservations(payload.reservations), { status: 201 });
    }
    return Response.json(createReservation(payload), { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}

export async function PATCH(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const payload = (await request.json()) as { id?: string; action?: string };
    if (payload.action === "receive") {
      return Response.json(receiveReservation(payload.id ?? ""));
    }
    if (payload.action === "undoReceive") {
      return Response.json(undoReceiveReservation(payload.id ?? ""));
    }
    throw new Error("不支持的预约操作。");
  } catch (error) {
    return jsonError(error, 400);
  }
}

export async function DELETE(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    return Response.json(deleteReservation(url.searchParams.get("id") ?? ""));
  } catch (error) {
    return jsonError(error, 400);
  }
}
