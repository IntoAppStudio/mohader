# AGENTS.md

A few conventions worth knowing before changing code here:

- `src/lib/*.server.ts` files are guaranteed server-only (stripped from the
  client bundle). `src/lib/*.functions.ts` files define TanStack Start server
  functions (`createServerFn`) — the file is referenced by client code, but
  handler bodies still only run on the server.
- All AI calls go through the single abstraction in `src/lib/ai.server.ts`.
  Every generated study item must carry `refs` (source block ids); the app
  discards items without them. Do not add outside knowledge into the prompts
  in `ai.server.ts`, `pipeline.server.ts`, or `video.server.ts` — the product
  is intentionally source-bound to the student's own uploaded files.
- Personal per-lesson notes (text/image/voice) live in `src/lib/notes.functions.ts`
  and `src/components/lesson-notes.tsx`, storing attachments in the private
  `note-media` bucket (separate from `sources`, same owner-only policy
  pattern). Follows the same "client uploads to storage, then a server
  function records the path" flow as `files.functions.ts`.
- Normal git practices apply: feature branches, review before merging to
  `main`, no force-pushing shared branches.
