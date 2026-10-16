# Keywulf architecture

Keywulf is a two-minute typing game made from a shared daily news briefing.
For example, before 01:00 UTC on October 15, the active game is October 14;
at 01:00, new requests select October 15. A player already typing October 14
keeps that text until the run ends. No deployment must finish at that instant.

The interesting boundary is between unreliable, expensive news generation and
stable gameplay: retries may do work more than once, but must not replace the
text somebody has already started typing. Players never call Gemini.

```text
Cloudflare cron                   GitHub Actions
00:20/30/40/50 UTC                test/build/deploy app code
01:05/25/45, 02:05/25/45 recovery  (independent of the daily switch)
          |
          v
Worker.scheduled -> DailyBriefing object named by date
                     | short storage transaction: claim lease
                     | outside transaction:
                     +--> Gemini + Google Search -> research notes
                     +--> SourceMetadata objects, keyed by URL hash
                     |      `--> publisher HTML / YouTube metadata
                     +--> Gemini -> formatted stories -> validation
                     `--> short transaction: check owner + store briefing

Player browser
  +--> Cloudflare Static Assets -> React / CSS / self-hosted fonts
  +--> GET /data/today.json -> Worker clock -> date's DailyBriefing -> JSON
  +--> localStorage: this browser's results, settings and resume snapshot
  +--> /api/runs/* -> date's DailyLeaderboard (private score -> opt-in top 50)
  |                    `--> browser's SpeedVerification -> Rust/WASM PNG
  `--> publisher images: optional, revealed after completed stories

GitHub freshness check -> public JSON, read-only -> failed job if unavailable
```

## From a scheduled attempt to a playable briefing

1. [Worker.scheduled](../worker/index.ts#L224) chooses the date from the trigger's
   scheduled time, not the visitor's location. [briefingForDate](../worker/index.ts#L37)
   maps the date to the same Durable Object for every caller. Normal preparation
   targets the current UTC date; [recoverySlot](../worker/recovery.ts#L7) admits
   only the six recovery slots before 03:00 UTC and records each claimed slot.
2. [DailyBriefing.prepare](../worker/index.ts#L139) atomically checks for a ready
   briefing and an unexpired lease. Ready dates return immediately; a busy date
   returns HTTP 202. Otherwise it stores a random owner ID and a 15-minute expiry.
3. [generateBriefing](../scripts/generateBriefing.ts#L20) researches current news,
   requiring substantial notes and grounding sources. It enriches source metadata,
   optionally refines labels, then asks for tool-free structured stories. Formatting
   retries reuse the notes and include validation feedback. Research and formatting
   each allow three attempts, with 20/40-second delays; an SDK request has a
   configured 90-second timeout. These are not a deadline for the whole pipeline.
4. [assembleChallenge](../scripts/buildChallenge.ts#L106) normalizes prose, ranks
   stories and trims low-ranked stories to the word budget.
   [validateChallenge](../scripts/challengeSchema.ts#L74) checks structure, ranks,
   12–16 stories, 150–300 typeable words, allowed characters, duplicate headlines,
   sources and the date-derived game number. Optional photos come from
   [attachStoryPhotos](../scripts/storyPhotos.ts#L26); matching is heuristic.
5. `prepare` rejects a wrong-date result and exact repetition of the previous
   day's text. In a final transaction it checks the lease owner, writes a missing
   briefing and its metadata version together, and releases the lease. The text
   remains unchanged if migration seeded the date while generation was pending.
6. [Worker.fetch](../worker/index.ts#L198) handles `/data/today.json` by choosing
   [activeChallengeDate](../src/lib/publication.ts#L6) once at request entry.
   The object's read returns the stored JSON with `no-store`, or HTTP 503 if absent.
   A request begun just before the boundary may complete afterward with the old
   date; it never combines dates. Static asset routes bypass this lookup.
7. [fetchTodayChallenge](../src/lib/challengeClient.ts#L141) loads and parses JSON.
   [App](../src/App.tsx#L47) refreshes idle home screens at the boundary and on
   visibility changes. It does not swap the corpus during play.
   [Play](../src/components/Play.tsx#L44) builds the passage and runs scoring locally.

## What owns each kind of data?

| Data | Owner and reason |
| --- | --- |
| Published briefing, lease, claimed recovery slots, metadata version | A date's SQLite-backed `DailyBriefing`. Storage survives object eviction and code deployment; transactions coordinate competing callers. The code uses its key/value API, not application SQL tables. |
| Source title, final URL and optional image metadata | `SourceMetadata`, keyed by SHA-256 of the input URL. Reuse is allowed for six hours for usable titles, one minute for unsuccessful resolution. Separate object calls also separate publisher-fetch request budgets. |
| Results, totals, settings, in-progress run | One versioned browser `localStorage` blob; ordinary gameplay remains independent of the leaderboard. No account or cross-device sync. |
| Private timed first run and opt-in daily top 50 | A date's `DailyLeaderboard` SQLite tables, separate from publication. Server replay scoring, indexed ranking and 35-day retention. |
| Image passage, timer, attempt budget and speed receipt | A browser's `SpeedVerification` object. Private answer never enters JSON; the server clock cannot be reset by a reload. |
| Cursor, per-character correctness, clocks, rolling samples | React refs in the mounted `Play` instance. Frequent engine updates do not require a React render for every character. The HUD updates at a configured 90 ms interval. |
| HTML/CSS/JS/fonts and local sample JSON | Build/static assets. The checked-in JSON supports local development; the production Worker intercepts the daily route and never substitutes that sample on failure. |

Source resolution is [bounded and order-preserving](../scripts/enrichSources.ts#L240)
with six concurrent resolvers. [resolveSource](../scripts/enrichSources.ts#L188)
limits redirects, body size and elapsed fetch time. Failed optional metadata falls
back to an available label. This does not prove that an article or image supports
the generated news summary. Publisher URLs/images can expire after publication.

## Concurrency and consistency

Suppose attempt A starts at 00:20 and is still running at 00:36. B can claim the
expired lease. A's external work has not been cancelled, but A cannot publish
after B replaces the owner ID. Its error cleanup also cannot delete B's lease.
This is an **ownership check**, often called fencing. It protects stored output,
not exactly-once billing. If no takeover occurs, expiry alone does not invalidate
A's final write. No lease renewal or whole-job cancellation is implemented.

Transactions contain only storage work. External requests happen between the
claim and commit transactions, where other requests can interleave. If a process
dies after claiming, a later trigger can take over after expiry. A valid published
briefing and its generation metadata version are committed together. A response
lost after commit can safely be retried: the next request finds the ready briefing.
The [lease takeover test](../worker/index.test.ts) delays both attempts explicitly.

Source labels and links are the narrow exception to immutable publication.
[sourceRepairIdentity](../scripts/refreshSourceTitles.ts#L34) excludes only those
two source fields and compares everything else, including photos and prose.
[commitSourceRepair](../worker/index.ts#L65) compares the entire stored snapshot
again inside a transaction before writing. The runner posts both its original
snapshot and the proposed metadata repair. If any other writer changed that
snapshot during publisher lookups, the stale request gets HTTP 409 and cannot
replace newer labels. The runner verifies that typed content is still unchanged
and skips the obsolete repair.

## Important invariants and their boundaries

| Invariant | Implementation and evidence |
| --- | --- |
| A visitor cannot start paid generation. | Public read routing and bearer-authenticated admin routes in [Worker.fetch](../worker/index.ts#L198); [worker tests](../worker/index.test.ts). |
| Once a date has text, retries/seed do not replace it. | [prepare and seed](../worker/index.ts#L74); tests cover retry, takeover and concurrent seeding. This assumes the existing namespace/date naming remains stable. |
| A stale generator cannot commit after ownership changes. | [prepare](../worker/index.ts#L139); takeover regression test. Overlapping model calls after expiry remain possible. |
| No partial or structurally invalid generated briefing is published. | [generateBriefing](../scripts/generateBriefing.ts#L20), [validateChallenge](../scripts/challengeSchema.ts#L74), final storage transaction. These checks do not prove factual truth. |
| Metadata repair cannot edit typed text or game identity. | [sourceRepairIdentity](../scripts/refreshSourceTitles.ts#L34), validation and transactional snapshot comparison; repair and refresh race tests. |
| Backspace does not erase an error from accuracy history. | [processChar/processBack](../src/components/Play.tsx#L188), [computeScore](../src/lib/scoring.ts#L58), browser-flow tests. WPM counts currently correct characters; accuracy counts all attempts. |
| Reload resumes saved active time, rather than counting offline wall time. | [Play clock and snapshots](../src/components/Play.tsx#L98), [getResumable](../src/lib/storage.ts#L321); expired-input and pagehide tests. Persistence remains best effort. |
| Practice cannot replace a retained official result. | [App.onComplete](../src/App.tsx#L169), [recordOfficialResult](../src/lib/storage.ts#L288), duplicate-result tests. This is a local app guarantee, not cross-tab serialization or anti-cheat. |

## Remaining limits and review findings

- **Lease duration versus work duration:** a 90-second per-request timeout and
  bounded retries do not bound total source count, SDK retry behavior or all
  network time to 15 minutes. A whole-job deadline/cancellation budget would
  reduce overlap. Choosing it needs duration/cost measurements; none are claimed here.
- **Streak retention:** [pruneResults](../src/lib/storage.ts#L215) retains 60 results;
  [aggregateStats](../src/lib/storage.ts#L347) derives streaks from only those dates.
  Current/longest streaks can therefore be capped or forgotten. Persisting streak
  summaries needs a schema/migration decision, so that change is deliberately deferred.
- **Local consistency:** two tabs read independent state and write the full blob
  in [saveState](../src/lib/storage.ts#L249). One can overwrite another's results.
  Storage failure falls back to session-only play; browser termination may lose
  the last snapshot. A storage-event merge alone would not make writes atomic.
- **Metadata protocol:** the runner includes its original challenge snapshot as
  a precondition for `/repair-sources`. A transaction compares it against the
  current stored briefing, rejecting delayed stale writes with HTTP 409. The
  runner treats a conflict as superseded only after confirming that the game text
  stayed unchanged. Concurrent `SourceMetadata` misses can still duplicate
  publisher fetches. No retry automatically merges competing metadata edits.
- **Freshness and model trust:** prompts and grounding are evidence, not a
  factual/recency proof. The monitor checks the active date and schema, not each
  article's age. Exact previous-text rejection does not detect all semantic repeats.
  Calendar-date validation is also stricter in the Worker than in the local CLI/schema.
- **Availability/scaling:** six late recovery slots end at 03:00; fresh-news-only
  policy can still leave a day unavailable. Every public JSON read reaches one
  date's object: static assets scale separately, but this read path is not load-tested
  here. Safe shared caching would require explicit date keys and a metadata policy.
- **Deployment is not publication:** deployments rotate an admin token and
  verify the active day; they can report failure if a different generation is
  still busy, or if the day rolls over mid-verification. That does not roll back
  already deployed code. The retry loop is not a complete deployment transaction.

## Verification

The optional daily leaderboard freezes a server-scored replay at completion,
then publishes only on request. Scores of at least 100 WPM require a separate
image transcription check. This supports typing ability, not human identity or
proof that the original daily replay was human. Request paths, concurrency rules,
limits, tests and the feature-flag rollback are in [COMMUNITY.md](COMMUNITY.md).

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` and
`npm run validate:challenge`; `npx wrangler deploy --dry-run` bundles the Worker
without uploading it. Tests use fake clocks, mocked Gemini/publisher responses
and an in-memory storage implementation. They cover application interleavings,
not Cloudflare's actual isolation, rollback, eviction, geographic latency or
live model quality. No performance/user-count claims follow from passing them.
Operational schedules, alert setup and rollback are in [RELIABILITY.md](RELIABILITY.md).

Platform contracts: [Cloudflare storage transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
and [object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).
