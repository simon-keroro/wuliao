import type { ReservationInput } from "@/lib/materials";
import { jsonError, requireAuth } from "@/lib/server/http";
import { createReservation, receiveReservation } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const payload = (await request.json()) as ReservationInput;
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
    if (payload.action !== "receive") {
      throw new Error("不支持的预约操作。");
    }
    return Response.json(receiveReservation(payload.id ?? ""));
  } catch (error) {
    return jsonError(error, 400);
  }
}
