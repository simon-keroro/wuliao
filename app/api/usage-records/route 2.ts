import type { UsageInput } from "@/lib/materials";
import { jsonError, requireAuth } from "@/lib/server/http";
import { createUsageRecord } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const payload = (await request.json()) as UsageInput;
    return Response.json(createUsageRecord(payload), { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}
