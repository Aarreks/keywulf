# Leaderboard and speed verification

The daily leaderboard is anonymous and opt-in. Finishing an official run freezes
a private server score immediately; posting it is a separate action. Practice,
local results and streaks continue working when the community service is down.
The interface reuses the existing result panels, buttons and score-list styles.

## Request path and guarantees

```text
first keystroke -> POST /api/runs/start -> date's DailyLeaderboard (SQLite)
finish typing  -> POST /api/runs/finish -> private, immutable first result
               -> SpeedVerification object for this browser
                  reveal PNG and focus input -> first character starts clock
                  exact match autosubmits -> receipt -> user posts -> top 50
```

- [handleCommunity](../worker/verificationRoutes.ts) creates an HttpOnly,
  SameSite=Strict anonymous cookie, checks write origins, limits bodies to 64 KB,
  and applies a coarse 120-requests/minute IP limit. The platform rate limit is
  per location, not a globally exact budget. Only today/yesterday are exposed.
- [DailyLeaderboard](../worker/leaderboard.ts) takes the corpus from the stored
  briefing, not the client. One SQLite primary key per browser prevents retries,
  reloads or concurrent tabs from replacing its first start/result. It recomputes
  scoring from a bounded character/backspace replay. Corrections preserve the
  accuracy history. The longer of server elapsed time and reported active time
  determines ranking, capped at the two-minute gameplay limit. A finish must
  arrive within 125 seconds of starting. Pauses count against ranking even though
  ordinary local gameplay can pause. Network latency can reduce ranked speed.
- [App.onComplete](../src/App.tsx) sends the replay immediately, before the user
  decides whether to publish. [finishRankedRun](../src/lib/communityClient.ts)
  retries one unknown/server-error outcome with the identical payload. The
  server stores its hash; different replacement submissions get HTTP 409.
  A refresh during a request can still lose the acknowledgement; a subsequent
  private status read recovers a committed result. An unsent finish cannot be
  reconstructed with trusted completion time after the deadline.
- [SpeedVerification](../worker/speedVerification.ts) stores the answer privately.
  Its JSON uses an explicit allowlist. The owning cookie can view the PNG before
  typing; the first character sends the start request for the non-pausable
  server timer. Its deadline is `characterCount * 12000 / requiredWpm`
  milliseconds (five characters per word), rounded down to a whole millisecond.
  For example, 200 characters at 75 WPM allows 32.0 seconds. The countdown shows
  tenths and never displays zero before expiry. There is no independent 60-second
  cap; longer/slower passages can allow more time. A start retry does not restart it. One active passage
  and twenty new passages per five minutes
  are enforced transactionally. Existing passages do not consume another slot
  on reload/retry. Old three-per-fifteen-minute lockouts reset once when the new
  policy is first used. Identical finish retries recover the saved
  outcome for 15 minutes; another answer cannot overwrite it.
  The frontend also retires an idle image when its ready window expires.
  A missing/expired challenge response to start, feedback, finish or cancel
  retires the corresponding UI, stopping its optimistic timer and allowing a
  fresh passage without reloading. Transient errors keep submission retries.
- Every public score must pass the check, at any WPM. The check requires
  `max(1, ceil(dailyWpm * 0.75))` WPM after completing the exact text. There is no
  separate accuracy-percentage requirement: mistakes can be corrected before
  completion. Case and extra whitespace are normalized. A salted SHA-256
  commitment lets the browser recognize a complete match without receiving the
  plaintext or querying the server on each keystroke. It immediately submits
  once; the server independently checks the text and elapsed time. Browser
  elapsed time can lengthen, but never shorten, server-observed duration, so the
  first-character request's latency can count. A lost response offers an exact
  retry, not a replacement answer. There is no normal submit button. Claims above 400 WPM are
  rejected. The server derives the claim from the private daily result.
- Optional typing feedback calls `/api/verification/check` after a 40 ms
  coalescing window, then at most once per 150 ms while text changes, with only
  one request in flight. There is no idle polling. Confirmed correct prefixes
  and a known first error are reused locally; appending beyond that error or
  editing later text requires no request. Network latency still applies.
  The object enforces a durable 100 ms cooldown and admits checks only while
  the owning browser's timer is running. It stores that small cooldown separately
  rather than rewriting the passage/image or resetting its alarm on each hint.
  Hints have a separate 600-requests/minute per-IP limiter; ordinary community
  actions retain their 120/minute budget, so hints cannot block submission.
  It returns the first wrong position, not expected letters or a whole-answer
  correctness mask. Later text remains ungraded until that error is corrected,
  avoiding cascading errors after a missing/extra character. Feedback can still
  serve as a bounded guessing oracle; it does not make the check OCR-proof.
  Replies whose prefix through the error was edited are ignored; changing text
  after the error keeps its highlight valid. A mirror uses the existing character-error style while
  the native textarea owns selection, input and scrolling. Whitespace positions
  map back to the original input. Invalid punctuation is marked locally. Network
  errors in this optional feedback never block exact-match submission. These
  checks add Worker/DO requests and bounded storage writes, not model calls.
- Publishing a score reads a receipt through a private binding and checks
  its date, corpus hash, expiry and speed. A browser cannot supply its own badge.
  The top 50 use full-precision WPM, then accuracy, completion time and stable ID.
  Public JSON exposes only alias, result ID, WPM, accuracy and check status.
- The optional nickname is chosen when posting and can be edited from the same
  browser afterward, without replacing the score. The server normalizes Unicode
  and whitespace, accepts 2–24 letters/numbers plus spaces, periods, underscores
  and hyphens, and rejects markup/control characters. Blank selects the generated
  alias. A local nickname preference carries across days. Names are not unique,
  authenticated identities or reserved handles; no profanity filter is claimed.
  Nickname updates use the same cookie ownership check as posting. Public reads
  can retain their previous response for up to ten seconds.
- Date objects remove records after 35 days. Verification images/answers are
  erased on completion/cancellation and expired state is removed by alarms;
  successful receipts expire after 30 days. Briefings have separate ownership
  and retention. No user score is written into publication storage.

## What this does and does not establish

The image renderer is adapted from an existing Workers-compatible Rust/WASM
CAPTCHA generator; see [provenance and rebuild instructions](../third_party/captcha/NOTICE.md).
It runs locally in the Worker: no image service or extra model call is needed.
Randomized letter offsets, smooth two-axis wave distortion, and interference
scaled to image height make the image harder to segment than plain text with
speckles. This has not been measured against OCR engines and is not an OCR-proof
claim. Existing active passages keep their original image; new passages use the
updated renderer.
The frontend receives pixels and a salted whole-passage hash, never the plaintext
answer in JSON, DOM text or PNG metadata.

A separate timed transcription supports typing ability. It is **not proof that
the daily run was human**. OCR, scripted replays and assisted input remain possible.
An anonymous cookie is not an account: clearing it or using another browser can
create another entry. The server cannot prove the client's actual keystroke times.
The image is deliberately readable before timing starts; studying/OCR before the
first-character request is possible. A whole-passage hash also permits offline
guesses, particularly for short low-speed passages; it is not an OCR defense.
No prize-bearing/identity-grade anti-cheat is claimed. The visual check is not
accessible to everyone; opting out preserves the local game and streak.
There is no cross-device identity, all-time ranking or moderation
console. These are deliberate scope limits, not implied existing capabilities.

One date is one ranking writer. SQLite indexes avoid sorting every run in
application memory, and static assets still bypass the Worker. This has not been
load-tested at production scale. CPU/storage/request costs grow with usage;
there is no new paid API call per check and no claimed fixed daily cost.

## Verify locally

1. Run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`,
   `npm run validate:challenge`, and `npx wrangler deploy --dry-run`.
2. Start `npx wrangler dev --local`. Use a separate local persistence directory
   for disposable integration tests. Do not use `--remote` or real model keys.
   The checked-in fixture alone is for Vite; the Worker needs a seeded briefing.
   Its existing authenticated `/_internal/seed?date=YYYY-MM-DD` endpoint can seed
   a synthetic fixture with a matching date/game number using a local-only admin
   token. Never seed test scores or fixture briefings into production.
3. Play locally. Confirm the result is saved privately before posting. Every
   result should require a separate passage, stay absent from the board until
   passed/published, focus the input after the image loads, start timing on the
   first character, and submit automatically only when the full text matches.
   Refreshing must retain the original running timer. Set a nickname
   when posting, edit it afterward, and confirm the score and entry ID stay fixed.
   Cancelling does not change the local result.
4. Set `KEYWULF_COMMUNITY_ENABLED = "false"` locally and confirm
   `/api/community` reports false, community routes return 503, and the daily
   briefing and ordinary play still work. Restore true; stored scores survive.

[community.test.ts](../worker/community.test.ts) uses real in-memory SQLite,
fake clocks and serialized storage transactions. It covers ownership, retries,
ranking, private posting, expiry, receipt binding and request validation.
[captcha.test.ts](../worker/captcha.test.ts) decodes a PNG rendered by the committed
WASM binary. [CommunityResult.test.tsx](../src/components/CommunityResult.test.tsx)
covers stale reads, image focus, timing, paste prevention and network retries.
These are not a Cloudflare availability guarantee or an OCR resistance benchmark.

## Reversible deployment

In GitHub Actions, open **Deploy app → Run workflow → main**, choose
`community_enabled: false`, and run it. This deploys the same application with
the feature disabled; normal daily publication and recovery schedules remain.
Check `/api/community` returns `{"enabled":false}` and today's briefing is still
available. To keep future pushes disabled too, set the repository Actions variable
`KEYWULF_COMMUNITY_ENABLED` to `false`; manual workflow input takes precedence.
Set both back to `true` and rerun to restore access to retained scores.

The migration adds two independent SQLite Durable Object classes. Keep their
bindings, exports and migration when disabling. A wholesale Git revert to a
version that lacks the classes is not the safe rollback path after migration;
removing classes/data requires a separate deliberate migration. Disabling the
flag leaves data to its normal expiry rather than deleting it.
