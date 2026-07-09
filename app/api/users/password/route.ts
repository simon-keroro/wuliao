import { jsonError, requirePermission } from "@/lib/server/http";
import { resetUserPassword } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requirePermission(request, "users:manage");
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json()) as { id?: string; password?: string };
    return Response.json({ users: resetUserPassword(payload.id ?? "", payload.password ?? "", user) });
  } catch (error) {
    return jsonError(error, 400);
  }
}
