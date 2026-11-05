/**
 * Scheduled deletion of uploaded files (privacy / data-minimisation).
 * `file_retention.delete_after` is set at upload time from the user's
 * retention_days (default 365). The cron route calls purgeExpiredFiles daily.
 */
import { asAnyDb } from "./untypedDb.server";

export async function scheduleRetention(admin: unknown, userId: string, fileId: string): Promise<void> {
  const db = asAnyDb(admin);
  const { data } = await db.from("user_compliance").select("retention_days").eq("user_id", userId).maybeSingle();
  const days = Math.min(3650, Math.max(1, Number(data?.retention_days) || 365));
  const deleteAfter = new Date(Date.now() + days * 86_400_000).toISOString();
  await db.from("file_retention").upsert({ file_id: fileId, user_id: userId, delete_after: deleteAfter }, { onConflict: "file_id" });
}

export async function purgeExpiredFiles(admin: unknown, limit = 200): Promise<{ purged: number }> {
  const db = asAnyDb(admin);
  const { data: due } = await db
    .from("file_retention")
    .select("file_id")
    .is("deleted_at", null)
    .lte("delete_after", new Date().toISOString())
    .limit(limit);

  let purged = 0;
  for (const row of due ?? []) {
    const fileId = row.file_id as string;
    const { data: versions } = await db.from("file_versions").select("storage_path").eq("file_id", fileId);
    const { data: file } = await db.from("files").select("storage_path").eq("id", fileId).maybeSingle();
    const paths = [...new Set([...(versions ?? []).map((v: { storage_path: string }) => v.storage_path), file?.storage_path].filter((p): p is string => Boolean(p)))];
    if (paths.length) await db.storage.from("sources").remove(paths);
    // Deleting the file cascades to its versions and blocks; generated lessons stay for the student.
    await db.from("files").delete().eq("id", fileId);
    purged += 1;
  }
  // Cached AI output derived from user material expires after 30 days.
  await db.from("ai_cache").delete().lt("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
  return { purged };
}
