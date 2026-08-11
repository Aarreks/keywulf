# Keywulf — Daily news typeracing

A once-per-day shared typing game built from the world's most important news.
Everyone on Earth gets the same briefing, in the same order, on the same UTC day,
and types it as a typing test. Wordle-style daily identity; typing-game feel.

- **Live text**: today's news, deduplicated and ranked by global significance.
- **Zero per-visitor cost**: AI runs once per day (GitHub Actions). Visitors get
  static HTML/CSS/JS + one static `today.json`. No database, no auth, no server
  calls during normal play.
- **All the "dynamic" is client-side**: the performance-reactive color system,
  live WPM/accuracy/telemetry, and animations are computed in the browser.

## Architecture

```
Once/day (GitHub Actions)                 Every visitor (Cloudflare edge)
┌───────────────────────────┐             ┌──────────────────────────────┐
│ generate-daily.ts         │  writes     │ static index.html + JS + CSS │
│  Gemini + Google Search   │ ─────────►  │ + /data/today.json           │
│  sanitize → validate      │  today.json │                              │
│  build → deploy (wrangler)│             │ gameplay = pure client, no   │
└───────────────────────────┘             │ AI, no DB, no per-user calls │
                                          └──────────────────────────────┘
```

- **Generation** (`scripts/generate-daily.ts`): asks Gemini (grounded with
  Google Search) to research ~24–30h of news, cluster duplicates, rank by
  significance, and return JSON. Output is sanitized to ASCII, assembled, and
  hard-validated. On failure it exits non-zero and does **not** deploy, so a bad
  day never replaces the last good puzzle.
- **Hosting**: Cloudflare Workers Static Assets (no Worker business logic). See
  `wrangler.toml` and `public/_headers` (fingerprinted assets cached forever;
  `today.json` always revalidated so nobody is stuck on yesterday's puzzle).
- **Daily identity**: `gameNumber` is derived deterministically from a documented
  UTC epoch (`src/lib/gameNumber.ts`), so no server counter is needed.

## Local development (Windows)

```powershell
npm install
npm run dev            # http://localhost:5173
```

The repo ships with a checked-in **sample challenge** (`public/data/today.json`),
so `dev`, `test`, and `build` all work with **no Gemini key**.

Common scripts:

```powershell
npm test               # unit tests (Vitest)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run build          # typecheck + production build to dist/
npm run build:sample   # rebuild the checked-in sample challenge
npm run validate:challenge   # validate public/data/today.json
```

Real generation (needs a key — never a `VITE_` variable):

```powershell
# PowerShell
$env:GEMINI_API_KEY = "your_key_here"
npm run generate:daily
```

```bash
# bash
GEMINI_API_KEY=your_key_here npm run generate:daily
```

## Application state (local, anonymous)

No account, no tracking. Everything lives in one versioned `localStorage` blob
(`src/lib/storage.ts`): official results keyed by challenge date, lifetime totals
(started/completed/best WPM), current + longest streak (derived), settings, and a
safe in-progress snapshot for resume. The schema is versioned and migrated so an
update never wipes a long streak. One **official** result per day (never
overwritten); **Practice** never touches official stats or streak.

## Visual system (high level)

A single smoothed `--energy` value (0–1) is computed client-side from rolling
WPM **and** accuracy (`src/lib/rolling.ts`) — fast-but-sloppy typing does not read
as excellent. It drives the accent color (cool slate → ember), the caret glow,
ambient background, and telemetry amplitude, all via CSS custom properties, so it
costs the same to serve for 1 or 1,000,000 users. Performance state is never
color-only (numerals + progress + graph carry it too). `prefers-reduced-motion`
and a "reduced intensity" setting are respected.

## Deployment

Full step-by-step setup (GitHub, Gemini, Cloudflare, DNS for `keywulf.com`) lives
in `DEPLOY.md`. CI (`.github/workflows/ci.yml`) runs on every push/PR using the
sample fixture. The daily job (`.github/workflows/daily.yml`) generates + deploys
at 00:15 UTC and is also runnable on demand.

Secrets required: `GEMINI_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## License

MIT
