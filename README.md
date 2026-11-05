# Mohader (محاضر)

An AI study companion that turns a student's own course files (PDF, Word,
PowerPoint, Excel, plain text) into lessons, explanations, practice questions
(MCQ, true/false, fill-in-the-blank, definitions, calculations, short answer),
study plans, and narrated explainer videos — all generated **strictly from the
uploaded material**. The AI is instructed to use only the supplied source
blocks and to cite the block(s) each item came from; ungrounded items are
discarded rather than shown to the student.

Built with [TanStack Start](https://tanstack.com/start) (React 19 + TanStack
Router, server functions, SSR) and [Supabase](https://supabase.com) (Postgres,
Auth, Storage). No dependency on any AI-builder platform: this is a normal
TanStack Start + Supabase project you can run, build, and host anywhere.

## Stack

- **Framework**: TanStack Start (Vite + Nitro), React 19, TypeScript (strict)
- **Package manager**: npm (comes with Node.js — see Requirements). Bun also
  works if you already have it, but nothing in this project requires it.
- **UI**: Tailwind CSS v4, shadcn/ui (Radix primitives)
- **Backend**: TanStack Start server functions (`src/lib/*.functions.ts`) and
  server-only modules (`src/lib/*.server.ts`) — no separate backend service
- **Database / Auth / Storage**: Supabase
- **AI**: a single provider-agnostic abstraction in `src/lib/ai.server.ts`

---

## Requirements (Windows 10)

You need one thing installed: **Node.js** (this also installs `npm`, which
you'll use for everything below).

1. Go to <https://nodejs.org> and download the **LTS** version for Windows.
2. Run the installer, keep the default options, click through to the end.
3. Open a terminal in the project folder: in File Explorer, open the
   `mohader` folder, then hold **Shift** and right-click an empty area
   inside it → **"Open PowerShell window here"** (Windows 10) — every
   command below is typed into that window.
4. Check it worked by typing `node -v` and pressing Enter — it should print
   a version number (e.g. `v22.x.x`), not an error.

You'll also need a free [Supabase](https://supabase.com) account (database)
and an API key from an AI provider (see Environment below) — both are set up
through a website, no installation needed.

## Install

```powershell
npm install
```

This downloads everything the project needs into a `node_modules` folder.
It only needs to be run once (and again later if `package.json` changes).

## Environment variables

```powershell
copy .env.example .env
```

Open the new `.env` file in Notepad and fill in real values (never share
this file or commit it to GitHub — it's already excluded via `.gitignore`).
Every variable is explained inside `.env.example`, in short:

- **Supabase** (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_PROJECT_ID`, and the `VITE_`-prefixed copies of the same three) —
  from your Supabase project's dashboard: **Project Settings → API**.
- **`SUPABASE_SERVICE_ROLE_KEY`** — same page, the "service_role" secret.
  This one is server-only and very sensitive — never put it in a `VITE_`
  variable or anywhere client-side.
- **AI provider** (`AI_GATEWAY_URL`, `AI_API_KEY`, `AI_MODEL`) — required for
  lesson/summary/question generation. `.env.example` has ready-to-use values
  for OpenRouter and OpenAI.
- **TTS, Paddle, cron** — optional. Leave these blank to run Mohader
  personally; those specific features just won't be available until you add
  the values later. Nothing else on the site is affected.

## Supabase setup

1. Create a project at <https://supabase.com/dashboard>.
2. Copy its URL and keys into `.env` as above.
3. Apply the database schema (all tables, security rules, storage buckets)
   with the [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started#installing-the-supabase-cli) —
   the Windows install is one `npx` command, no separate installer:
   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```
   `YOUR_PROJECT_REF` is in your project's URL:
   `supabase.com/dashboard/project/<this-part>`. `db push` applies every file
   in `supabase/migrations/` in order — this creates all tables, security
   policies, and file-storage buckets in one step.

## Run locally

```powershell
npm run dev
```

Open the URL it prints (usually `http://localhost:3000`) in your browser.
Stop it anytime with **Ctrl+C** in the terminal.

## Build (verify it's ready to publish)

```powershell
npm run typecheck
npm run lint
npm run build
```

Run these in order. Each should finish with no red error text. `build`
produces the production version of the site — if it completes without
errors, the site is ready to deploy.

To run that production build on your own computer (to test it the same way
it will run once deployed):

```powershell
npm run build
npm run start
```

`start` runs the server that `build` produced, using the standard output
location for a plain Node.js server (`.output/server/index.mjs`) — this is
what `build` creates when it isn't running on a hosting platform. Open the
URL it prints. (Note: this exact path follows the framework's standard
convention but was written without being able to run a real build in the
environment this project was prepared in — if `start` says it can't find
that file, look inside the `.output` folder that `build` created for the
server entry file and adjust the `start` script in `package.json`.)

## Deploy

Mohader has real server-side code (it's not a plain static site), so it
needs a host that runs server functions — **not** GitHub Pages. Any of
these work with no extra configuration (the build auto-detects which one
you're using):

- **[Vercel](https://vercel.com)** or **[Netlify](https://netlify.com)** —
  easiest for a first deployment: create a free account, "Import" your
  GitHub repository, add the same variables from your `.env` file in that
  site's dashboard (never upload the `.env` file itself), and it deploys
  automatically.
- **Cloudflare Pages** — similar flow, good free tier.

After the first deploy, go back to your Supabase project's **Authentication
→ URL Configuration** and add your new live URL (e.g.
`https://your-app.vercel.app`) as a **Redirect URL** — without this, sign-up
confirmation and password-reset emails will link back to the wrong address.

## Troubleshooting

- **`npm install` fails** — check `node -v` is 18 or newer; delete the
  `node_modules` folder and `package-lock.json` if present, then retry.
- **Blank page / "Missing Supabase environment variable(s)"** — `.env` is
  missing a value, or you edited `.env.example` instead of a real `.env`
  file. Re-check the Environment section above.
- **AI features fail with a clear error toast** — `AI_GATEWAY_URL` /
  `AI_API_KEY` / `AI_MODEL` aren't set, or the key/model is wrong for that
  provider. This is a configuration error, not a bug — the app is designed
  to fail clearly here rather than silently.
- **A deploy host's build fails looking for a lockfile** — run `npm install`
  locally once (creates `package-lock.json`), commit that file, and redeploy.
