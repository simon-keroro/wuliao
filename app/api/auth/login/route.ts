import { sessionCookie } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/http";
import { authenticateUser } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { username?: string; password?: string };
    const user = authenticateUser(payload.username ?? "", payload.password ?? "");
    if (!user) {
      return Response.json({ error: "用户名或密码不正确，或账号已停用。" }, { status: 401 });
    }

    return Response.json(
      { ok: true, user },
      {
        headers: {
          "Set-Cookie": sessionCookie(user),
        },
      },
    );
  } catch (error) {
    return jsonError(error, 500);
  }
}
