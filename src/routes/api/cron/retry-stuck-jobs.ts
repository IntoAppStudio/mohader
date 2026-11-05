// Scheduled sweep for jobs stuck in QUEUED/RUNNING. Protected by
// CRON_SECRET (see src/integrations/supabase/cron-auth.ts). See
// src/routes/api/checkout.ts for the note on the route syntax used here.
import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { retryStuckJobs } from "@/lib/jobs.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/cron/retry-stuck-jobs")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        try {
          const result = await retryStuckJobs(supabaseAdmin);
          return new Response(JSON.stringify(result), { status: 200 });
        } catch (error) {
          console.error("[cron] retry-stuck-jobs failed", error);
          return new Response(JSON.stringify({ error: "SWEEP_FAILED" }), { status: 500 });
        }
      },
    },
  },
});
