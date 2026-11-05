import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

/** Every user owns exactly one workspace; the signup trigger creates it, this heals older rows. */
export async function ensureWorkspace(supabase: Db, userId: string): Promise<string> {
  const existing = await supabase
    .from("workspaces")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.data?.id) return existing.data.id;

  const created = await supabase
    .from("workspaces")
    .insert({ user_id: userId, name: "Workspace" })
    .select("id")
    .single();
  if (created.error || !created.data) throw new Error("WORKSPACE_UNAVAILABLE");
  return created.data.id;
}

/** Server-side ownership check: never trust a course id coming from the client. */
export async function assertCourseOwner(supabase: Db, courseId: string) {
  const { data, error } = await supabase
    .from("courses")
    .select("id, workspace_id, title, is_built")
    .eq("id", courseId)
    .maybeSingle();
  if (error || !data) throw new Error("COURSE_NOT_FOUND");
  return data;
}

/** Server-side ownership check: the lesson must exist, belong to the caller (via RLS), and
 * actually be a lesson of the given course — never trust a client-supplied (courseId, lessonId) pair. */
export async function assertLessonOwner(supabase: Db, courseId: string, lessonId: string) {
  const { data, error } = await supabase
    .from("lessons")
    .select("id, course_id, title")
    .eq("id", lessonId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (error || !data) throw new Error("LESSON_NOT_FOUND");
  return data;
}
