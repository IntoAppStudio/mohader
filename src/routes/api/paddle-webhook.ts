// Server route for Paddle's webhook calls. See src/routes/api/checkout.ts for
// the note on why this uses createFileRoute + `server.handlers` and what to do
// if that shape isn't accepted by the installed TanStack Start version.
import { createFileRoute } from "@tanstack/react-router";
import { handlePaddleWebhook, WebhookAuthError } from "@/lib/paddle-webhook.server";

export const Route = createFileRoute("/api/paddle-webhook")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const rawBody = await request.text();
        try {
          const result = await handlePaddleWebhook(rawBody, request.headers.get("Paddle-Signature"));
          return new Response(JSON.stringify(result), { status: 200 });
        } catch (error) {
          if (error instanceof WebhookAuthError) {
            return new Response(JSON.stringify({ error: "INVALID_SIGNATURE" }), { status: 401 });
          }
          console.error("[paddle-webhook] processing failed", error);
          return new Response(JSON.stringify({ error: "PROCESSING_FAILED" }), { status: 500 });
        }
      },
    },
  },
});
