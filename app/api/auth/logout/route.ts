import { clearSessionCookie, getCurrentUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = getCurrentUser(request);
  if (user) logAudit(user, "auth.logout", user.username, {});

  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": clearSessionCookie(),
      },
    },
  );
}
