import { sessionCookie, validatePassword } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { password?: string };
    if (!validatePassword(payload.password ?? "")) {
      return Response.json({ error: "密码不正确。" }, { status: 401 });
    }

    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": sessionCookie(),
        },
      },
    );
  } catch (error) {
    return jsonError(error, 500);
  }
}
