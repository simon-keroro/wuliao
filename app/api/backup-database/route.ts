import { jsonError, requireAuth } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { runDatabaseBackup } = await import("../../../scripts/backup-database.mjs");
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
