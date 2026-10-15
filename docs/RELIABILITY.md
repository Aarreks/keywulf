# Daily publication recovery

The normal preparation slots remain **00:20, 00:30, 00:40 and 00:50 UTC**.
Publication still selects the date's stored briefing at **01:00 UTC**. It does
not require a deployment or a cron invocation at that instant.

When preparation has not succeeded, automatic recovery tries at **01:05,
01:25, 01:45, 02:05, 02:25 and 02:45 UTC**. Each slot is claimed transactionally
in that date's Durable Object before generation starts. Failed delivery replays
cannot generate again for an already claimed slot. The existing 15-minute lease
suppresses concurrent generation while valid and lets a later slot recover after
a crashed invocation. Expiry does not cancel old model work; an owner-ID check
prevents a replaced attempt from committing. Busy slots skip; they do not queue
extra generation. There are at
most six recovery pipeline invocations per date, in addition to normal preparation.
Each pipeline invocation retains its existing bounded internal model retries.

Delayed recovery triggers are ignored at or after 03:00 UTC or if their game
date is no longer active. An invocation started before the deadline may finish
after it. Manual authenticated preparation remains available after exhaustion.
Success makes later attempts no-ops. Ready text remains immutable; stored recovery
records add no storage migration and can safely remain after rollback.

Fresh news is required. Failure serves HTTP 503 rather than yesterday's text or
a sample renamed as today's game. This improves recovery but does not guarantee
on-time release when the upstream provider is unavailable. It does not modify
browser streak calculations or compensate players for a prolonged outage.

## Verify without deploying or spending on AI

Use Node 22 or newer, then:

```sh
npm ci
npm test -- worker/index.test.ts scripts/check-freshness.test.ts
npm run typecheck
npm run lint
npm run build
npx wrangler deploy --dry-run
```

The tests mock the generator and clock. They simulate all four normal failures,
503 at release, automatic recovery, six-slot exhaustion, replay after object
eviction, expired leases, disabled recovery, invalid/old trigger deliveries and
manual recovery after exhaustion. Existing tests check concurrency, immutable
text, authentication and rejection of repeated previous-day text. The freshness
probe tests missing, stale, malformed and unreachable public briefings.

## Freshness alert

The independent `Daily briefing freshness` Actions workflow checks the public
endpoint at **01:10 and 03:10 UTC**, and can also be run manually. A missing,
stale or invalid challenge fails the job with an error annotation. It reads only
the public briefing and never invokes generation or deployment. It needs no secrets.
Actions schedules can be delayed or disabled for repository inactivity, so these
checks are an alert mechanism rather than the publication clock.

Before relying on email/web delivery, watch the repository and enable Actions
notifications (optionally failed runs only) in your GitHub notification settings:
[GitHub's notification instructions](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications).
Scheduled-run recipient rules are described in
[workflow notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).
This change does not alter your notification preferences or send an alert now.

Run the probe on demand:

```sh
npx tsx scripts/check-freshness.ts
```

It exits zero only for a valid active-date briefing. `KEYWULF_FRESHNESS_URL` can
point it at a local test server returning 503 to exercise the failure exit path;
the mocked tests exercise that path without another server.

## Deployment review and rollback

**Merging to main triggers the existing Deploy app workflow.** Review first,
then merge when ready to deploy. Afterward:

1. Confirm the Deploy app run succeeds and the public freshness probe passes.
2. In Cloudflare, confirm both cron expressions in `wrangler.toml` are present
   and `KEYWULF_RECOVERY_ENABLED` is `true`. Trigger changes can take up to 15
   minutes to propagate. Review scheduled invocation logs after a recovery slot;
   an already ready date must cause no generation.
3. Manually run `Daily briefing freshness` in Actions. Verify notifications are
   configured for the person maintaining the schedule.

For a narrow rollback, set `KEYWULF_RECOVERY_ENABLED = "false"` in `wrangler.toml`
and redeploy. The normal four slots still work. You can also remove just the
recovery cron expression. For a full rollback, `git revert <merged-change-commit>`
and deploy the revert through the existing workflow. No Durable Object deletion
or text replacement is needed. Disable/remove the freshness workflow separately
if you only want to stop monitoring. Before merging, close the PR to discard it.
