# Keywulf — Daily news typeracing

A once-per-day shared typing game built from the world's most important news.
Everyone on Earth gets the same briefing, in the same order, on the same UTC day,
and types it as a typing test. Wordle-style daily identity; typing-game feel.

- **Live text**: today's news, deduplicated and ranked by global significance.
- **One shared briefing per day**: Cloudflare prepares news before release.
  Visitors get static HTML/CSS/JS and one stored briefing; playing never calls
  the model. Optional article photos load from their publishers after you type
  each story. Briefing reads use Workers/Durable Objects quotas; static assets
  still serve directly.
- **All the "dynamic" is client-side**: the performance-reactive color system,
  live WPM/accuracy/telemetry, and animations are computed in the browser.

## Architecture

Start with [the architecture guide](docs/ARCHITECTURE.md) for the request path,
storage decisions, code links, tested guarantees and remaining limitations.

```
Cloudflare preparation (00:20, 00:30, 00:40, 00:50 UTC)
  Gemini + Google Search → sanitize + validate → stored immutable briefing

Cloudflare serving (server clock, no cron required for the switchover)
  before 01:00 UTC → previous date's briefing
  from   01:00 UTC → new date's prepared briefing

GitHub Actions → validate + build + deploy app code independently
```

- **Generation** (`scripts/generateBriefing.ts`): asks Gemini (grounded with
  Google Search) to research ~24–30h of news, cluster duplicates, rank by
  significance, and return JSON. Output is sanitized to ASCII, assembled, and
  hard-validated. Research uses the actual current date even when preparing
  tomorrow's game. The local CLI remains `npm run generate:daily`.
- **Publication** (`worker/index.ts`): a SQLite-backed Durable Object stores one
  immutable text per date. Cloudflare attempts preparation at 00:20, 00:30,
  00:40 and 00:50 UTC, skipping the model when
  a briefing is ready. A valid generation lease suppresses overlapping calls;
  ownership checks protect publication if an expired lease is taken over.
  At exactly 01:00 UTC, requests select the new date by server clock. No job
  needs to start and no app deployment needs to finish at that moment. Idle
  home screens refresh at the boundary; active typing runs keep their corpus.
  If fresh generation fails, the game shows a retry message and retries
  preparation; it never labels a sample or yesterday's text as new news.
- **Hosting**: Cloudflare Workers Static Assets plus the small publication
  Worker. `wrangler.toml` routes only briefing/private preparation endpoints
  through the Worker; the app's static assets are served directly. Briefing
  responses use `Cache-Control: no-store`.
- **Daily identity**: `gameNumber` is derived deterministically from a documented
  UTC epoch (`src/lib/gameNumber.ts`), so no server counter is needed.
- **Story photos**: the daily job collects article preview images in the same
  requests used to resolve source titles. Only closely matching sources are
  used; unavailable photos are skipped. Photos reveal below the passage as
  stories are typed, link to their publisher, and never affect the typed text.
- **Source titles**: every grounding source is resolved, with six requests in
  parallel. Separate cached source-metadata Durable Objects keep each publisher
  fetch within its own request budget. YouTube uses oEmbed first, then bounded
  watch-page metadata for videos that disable embedding. Article titles also
  support Twitter metadata and JSON-LD. Blocked/unavailable publishers retain a
  domain label when no trustworthy title or readable URL slug is available.
  Deployment checks unresolved labels again from the runner, since some sites
  serve incomplete metadata to Cloudflare. Its authenticated metadata-only
  update is rejected if any protected game field differs.

## Local development (Windows)

Requires Node.js 22 or later.

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
update can recover older records. History retains at most 60 results, so derived
streaks and averages only cover that window; lifetime completion count and best
WPM are stored separately. One **official** result per retained day is preserved
within an app instance; separate tabs can overwrite the whole storage blob.
**Practice** never touches official stats or streak.

## Visual system (high level)

A single smoothed `--energy` value (0–1) is computed client-side from rolling
WPM **and** accuracy (`src/lib/rolling.ts`) — fast-but-sloppy typing does not read
as excellent. It drives the accent color (cool slate → ember), the caret glow,
ambient background, and telemetry amplitude, all via CSS custom properties, so it
requires no server request per keystroke. Briefing reads still scale with traffic.
Performance state is never
color-only (numerals + progress + graph carry it too). `prefers-reduced-motion`
and a "reduced intensity" setting are respected.

## Deployment

CI (`.github/workflows/ci.yml`) validates both the app and Worker on every
push/PR using the sample fixture. **Deploy app** (`.github/workflows/daily.yml`)
deploys pushes to `main` and can also be run manually. Daily publication no
longer depends on GitHub's best-effort scheduler or repository inactivity.

Deployment preserves the exact live briefing and seeds it into durable storage
without replacing existing texts. It also prepares a missing current briefing
and verifies the public endpoint. Subsequent app deployments leave published
typed text untouched. Deployment can repair the current briefing's source
labels and links through a protected, versioned metadata update; date, game
number, word count, headlines, bodies, photos and result identity stay unchanged.
The Worker prepares future briefings independently.

Secrets required: `GEMINI_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

Add these under the repository's **Settings → Secrets and variables → Actions**.
The Cloudflare token must allow deploying the `keywulf` Worker in the supplied
account. Hosting configuration is in `wrangler.toml`; connect `keywulf.com` to
that Worker in Cloudflare.

To change the generation model without editing code, set the Actions repository
variable `GEMINI_MODEL` to a Gemini model that supports Google Search grounding.
The default is set in `scripts/generateBriefing.ts`. For local generation, export
the environment variables as shown above; copying `.env.example` to `.env`
alone does not load them into the script.

Deployment copies `GEMINI_API_KEY` and the selected model into Cloudflare Worker
secrets using Wrangler. A random operator token protects internal preparation
and migration endpoints and is never included in the browser bundle. No new
credentials need to be entered. The Cloudflare token must also allow editing
the Worker's cron triggers and adding its SQLite Durable Object binding.

Use **Actions → Deploy app → Run workflow** to redeploy the app. Published
briefings are immutable, including on manual redeployment.

### Scheduled workflow maintenance

GitHub can disable scheduled workflows after repository inactivity. The daily
game now uses Cloudflare preparation triggers and clock-based publication, so
GitHub inactivity does not stop daily releases. Inspect Cloudflare's Worker cron
events/logs to diagnose preparation failures.

### Recovery and freshness monitoring

The four normal preparation slots remain 00:20/00:30/00:40/00:50 UTC. Bounded
late recovery adds six slots between 01:05 and 02:45 UTC when today's fresh
briefing is missing. An independent Actions freshness check fails when the
public briefing is missing, stale or invalid. See
[the reliability runbook](docs/RELIABILITY.md) for outage simulations, notification
setup, deployment checks, the recovery kill switch and rollback instructions.

## License

MIT
