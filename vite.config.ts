import path from "node:path";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// Vite configuration for the TanStack Start app: router/SSR integration,
// React, Tailwind, and "@/*" path-alias resolution.
export default defineConfig({
  plugins: [
    // Resolves the "@/*" -> "./src/*" alias from tsconfig.json.
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // SSR requests are handled by our own src/server.ts wrapper (adds
      // error capture around the framework's default server entry).
      server: { entry: "server" },
      // No hardcoded Nitro target: Nitro auto-detects the deployment
      // platform from environment variables the host sets during its own
      // build (Vercel, Netlify, Cloudflare Pages, ... all do this), so the
      // same config works unmodified across hosts. An earlier version of
      // this file forced "cloudflare-module", which is almost certainly why
      // both Vercel and Netlify failed — the build was being shaped for
      // Cloudflare Workers specifically regardless of where it actually ran.
      // If a host's auto-detection ever doesn't kick in, force it explicitly
      // with a NITRO_PRESET env var in that host's project settings (e.g.
      // NITRO_PRESET=vercel or NITRO_PRESET=netlify) rather than hardcoding
      // it here again.
    }),
    viteReact(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Avoids duplicate React/TanStack instances if anything gets linked or
    // hoisted unusually by the package manager.
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
});

// Not configured here, add if you want them:
//   - Router/Start devtools (dev-only). Install @tanstack/react-devtools if
//     you'd like it back.
//   - `server: { host, port }` above, if you need something specific for
//     your own dev environment. Standard Vite dev-server defaults apply
//     otherwise.
