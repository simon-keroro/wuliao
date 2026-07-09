import type { PasswordChangeInput } from "@/lib/materials";
import { jsonError, requireUser } from "@/lib/server/http";
import { changeOwnPassword } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requireUser(request);
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json()) as PasswordChangeInput;
    return Response.json({ user: changeOwnPassword(payload, user) });
  } catch (error) {
    return jsonError(error, 400);
  }
}
