import { requireUser } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = requireUser(request);
  if (user instanceof Response) return user;
  return Response.json({ user });
}
