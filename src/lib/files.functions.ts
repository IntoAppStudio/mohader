import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Registers an already-uploaded object and queues extraction. */
export const registerSourceFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      courseId: string;
      storagePath: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertCourseOwner } = await import("./db.server");
    const course = await assertCourseOwner(supabase, data.courseId);
    if (!data.storagePath.startsWith(`${userId}/`)) throw new Error("INVALID_STORAGE_PATH");
    // Minors need guardian consent before uploading (legacy accounts without a record are only prompted).
    {
      const { asAnyDb } = await import("./untypedDb.server");
      const { canUpload } = await import("./compliance");
      const { data: compliance } = await asAnyDb(supabase).from("user_compliance").select("is_minor, guardian_consent_at, terms_accepted_at").eq("user_id", userId).maybeSingle();
      if (!canUpload(compliance ?? null)) throw new Error("GUARDIAN_CONSENT_REQUIRED");
    }
    const { assertFileQuota } = await import("./quota.server");
    await assertFileQuota(supabase, userId, data.courseId, Number(data.sizeBytes) || 0);

    const { isExtractable } = await import("./extract.server");
    const supported = isExtractable(data.mimeType, data.originalName);

    const { data: file, error } = await supabase
      .from("files")
      .insert({
        user_id: userId,
        workspace_id: course.workspace_id,
        course_id: data.courseId,
        original_name: data.originalName,
        mime_type: data.mimeType,
        size_bytes: data.sizeBytes,
        storage_path: data.storagePath,
        status: supported ? "PROCESSING" : "FAILED",
        error_message: supported ? null : "UNSUPPORTED_FILE_TYPE",
      })
      .select("id")
      .single();
    if (error || !file) throw new Error("FILE_REGISTER_FAILED");

    await supabase.from("file_versions").insert({
      user_id: userId,
      file_id: file.id,
      version: 1,
      storage_path: data.storagePath,
      size_bytes: data.sizeBytes,
    });

    // Scheduled deletion of the original (retention policy); never blocks the upload.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { scheduleRetention } = await import("./retention.server");
      await scheduleRetention(supabaseAdmin, userId, file.id);
    } catch (retentionError) {
      console.error("[retention] schedule failed", retentionError);
    }

    return { id: file.id, supported };
  });

export const processSourceFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { fileId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { processUploadedFile } = await import("./pipeline.server");
    return processUploadedFile(supabase, userId, data.fileId);
  });

export const deleteSourceFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { fileId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: file } = await supabase
      .from("files")
      .select("id, storage_path")
      .eq("id", data.fileId)
      .maybeSingle();
    if (!file) throw new Error("FILE_NOT_FOUND");
    await supabase.storage.from("sources").remove([file.storage_path]);
    const { error } = await supabase.from("files").delete().eq("id", data.fileId);
    if (error) throw new Error("FILE_DELETE_FAILED");
    return { ok: true };
  });

/** Short-lived signed URL so the user can open their own original file. */
export const getSourceFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { fileId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: file } = await supabase
      .from("files")
      .select("storage_path")
      .eq("id", data.fileId)
      .maybeSingle();
    if (!file) throw new Error("FILE_NOT_FOUND");
    const signed = await supabase.storage.from("sources").createSignedUrl(file.storage_path, 300);
    if (signed.error || !signed.data) throw new Error("SIGN_FAILED");
    return { url: signed.data.signedUrl };
  });

export const getFileBlocks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { fileId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: blocks } = await supabase
      .from("content_blocks")
      .select("id, page, position, section, block_type, original_text")
      .eq("file_id", data.fileId)
      .order("position")
      .limit(400);
    return blocks ?? [];
  });
