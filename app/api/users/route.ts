import type { UserInput, UserUpdateInput } from "@/lib/materials";
import { jsonError, requirePermission } from "@/lib/server/http";
import { createUser, listUsers, updateUser } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = requirePermission(request, "users:manage");
  if (user instanceof Response) return user;

  try {
    return Response.json({ users: listUsers() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  const user = requirePermission(request, "users:manage");
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json()) as UserInput;
    return Response.json({ users: createUser(payload, user) }, { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}

export async function PUT(request: Request) {
  const user = requirePermission(request, "users:manage");
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json()) as UserUpdateInput;
    return Response.json({ users: updateUser(payload, user) });
  } catch (error) {
    return jsonError(error, 400);
  }
}
