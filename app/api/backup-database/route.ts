import { jsonError, requireAuth } from "@/lib/server/http";

export const dynamic = "force-dynamic";

function isSamePassword(input: string, expected: string) {
  return input.trim() === expected.trim();
}

export async function POST(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const payload = (await request.json().catch(() => ({}))) as { password?: string };
    const { getRequiredBackupPassword, runDatabaseBackup } = await import("../../../scripts/backup-database.mjs");
    const expectedPassword = getRequiredBackupPassword();
    if (!payload.password || !isSamePassword(payload.password, expectedPassword)) {
      return Response.json({ error: "备份密码错误。" }, { status: 403 });
    }

    const result = await runDatabaseBackup();
    return Response.json({
      ok: true,
      sent: result.sent,
      to: result.to,
      generatedAt: result.generatedAt,
      counts: result.counts,
    });
  } catch (error) {
    return jsonError(error, 500);
  }
}
