import { jsonError, requirePermission } from "@/lib/server/http";
import { logAudit } from "@/lib/server/store";

export const dynamic = "force-dynamic";

function isSamePassword(input: string, expected: string) {
  return input.trim() === expected.trim();
}

export async function POST(request: Request) {
  const user = requirePermission(request, "backup:run");
  if (user instanceof Response) return user;

  try {
    const payload = (await request.json().catch(() => ({}))) as { password?: string };
    const { getRequiredBackupPassword, runDatabaseBackup } = await import("../../../scripts/backup-database.mjs");
    const expectedPassword = getRequiredBackupPassword();
    if (!payload.password || !isSamePassword(payload.password, expectedPassword)) {
      return Response.json({ error: "备份密码错误。" }, { status: 403 });
    }

    const result = await runDatabaseBackup();
    logAudit(user, "backup.run", result.to || "local-dry-run", { sent: result.sent });
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
