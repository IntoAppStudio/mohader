// TanStack Start server route (raw Request -> Response, no component). Uses
// createFileRoute — the same API every other route in this project already
// uses — with the `server.handlers` option, the current pattern for HTTP
// handlers in recent TanStack Start 1.x releases (an older
// `createServerFileRoute(...).methods(...)` form existed briefly and was
// replaced, which is why this file no longer imports it).
//
// UNVERIFIED against the exact installed version (no install was possible
// where this was written). Deliberately NOT wrapped in a type cast: if your
// installed version doesn't accept `server.handlers`, `npm run typecheck`
// will flag this exact line — that error is the signal to look up "Server
// Routes" in the TanStack Start docs for your version. At runtime the worst
// case is that this one endpoint doesn't respond; it cannot break the build
// or any other page. The logic itself lives in src/lib/checkout.server.ts.
import { createFileRoute } from "@tanstack/react-router";
import { createCheckout } from "@/lib/checkout.server";

export const Route = createFileRoute("/api/checkout")({
  server: {
    handlers: {
      POST: ({ request }: { request: Request }) => createCheckout(request),
    },
  },
});
