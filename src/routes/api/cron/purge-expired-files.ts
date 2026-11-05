// Scheduled deletion of uploaded source files whose retention period has passed.
// Protected by CRON_SECRET. Schedule daily.
import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { purgeExpiredFiles } from "@/lib/retention.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/cron/purge-expired-files")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        try {
          const result = await purgeExpiredFiles(supabaseAdmin);
          return new Response(JSON.stringify(result), { status: 200 });
        } catch (error) {
          console.error("[cron] purge-expired-files failed", error);
          return new Response(JSON.stringify({ error: "PURGE_FAILED" }), { status: 500 });
        }
      },
    },
  },
});
