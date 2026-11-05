// Queue worker endpoint. Protected by CRON_SECRET (same scheme as retry-stuck-jobs).
// Schedule it every minute (Supabase pg_cron + pg_net, Vercel/Cloudflare cron, or any scheduler).
import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { runQueueWorker } from "@/lib/queue.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/cron/run-queue")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        try {
          const result = await runQueueWorker(supabaseAdmin);
          return new Response(JSON.stringify(result), { status: 200 });
        } catch (error) {
          console.error("[cron] run-queue failed", error);
          return new Response(JSON.stringify({ error: "QUEUE_FAILED" }), { status: 500 });
        }
      },
    },
  },
});
