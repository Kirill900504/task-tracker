@AGENTS.md

# РОКАС — a personal task tracker

Read this first, then `git log` — the commit messages are the project's
real log, written to explain *why*, not *what*. Everything below is the
part that is expensive to rediscover: it is here so a new session does not
have to re-read the code (or an old conversation) to be useful.

One user: Кирилл, the owner, in Russian. Deployed at
task-tracker-beta-ebon.vercel.app, pushed to `main` = deployed. He checks
production the moment you say something is done, so **report only after the
Vercel deploy is Ready and you have verified it there**.

Stack: Next.js 16 (App Router, Turbopack) · React 19 · TypeScript ·
Supabase (Postgres + Auth + Realtime + RLS) · Vercel · GigaChat for
language · Telegram and MAX bots. The UI language is Russian; code and
comments are English.

## How to work here

- **He is not technical, and asking him to figure anything out is a failure
  of the answer, not of him.** He has said this outright, more than once and
  with feeling: always propose the most self-sufficient option, do it
  yourself, and when something genuinely cannot be done from here, hand him
  a direct clickable link to the exact page and the one thing to type — never
  a path through menus, never "найди раздел…", never a terminal command as
  the first suggestion. Two clicks and a password is the budget. If a step
  costs more than that, it is the wrong step: find another way round, and
  spend the effort here rather than on his side.
- Do the whole task, then verify, then report. He does not want to be asked
  for permission — he has said so explicitly — but he does want to be told
  what was decided and what was left out.
- **Finished work goes straight to `main`, always.** He said it in those
  words: «вливай всегда сразу все изменения». A session branch is a place
  to work, not a place to leave things — merge it into `main` and push the
  moment the checks are green, and never end a task with the change sitting
  in a branch waiting for him to say "merge". The checks are what stands
  between a merge and a broken production, so they are not optional.
- Every change ends with: `npm test` (unit), `npm run lint`, `npm run build`,
  and the e2e suite where the change is visible. Nothing is "done" while a
  check is failing; say so instead.
- Comments explain the reason a thing is the way it is, especially when it
  looks odd. Match that density — it is the whole reason this codebase can
  be picked up cold.
- Commit messages: a short imperative title, then prose explaining what was
  wrong and why this is the fix. No bullet-point changelogs.
- UI improvements land everywhere the pattern occurs, not only where he
  pointed. Same for fixes.

## Commands

```
npm test              # vitest, ~190 unit tests
npm run lint          # eslint (React compiler rules are ON — see below)
npm run build         # next build; must pass before any deploy
npm run test:e2e      # Playwright; defaults to PRODUCTION, E2E_BASE_URL=http://localhost:3100 for local
npm run test:rls      # every table's row-level security, against the real database
npm run test:schema   # applies every migration to a throwaway local Postgres and
                      # exercises the multi-user access rules — no credentials,
                      # no production. Run it BEFORE any migration goes anywhere.
npm run test:bots     # drives both messenger webhooks end to end
node --env-file=.env.local scripts/run-migration.mjs supabase/migrations/00NN_x.sql
node --env-file=.env.local scripts/max-setup.mjs https://<deployment>   # MAX webhook, fallback for /max
```

E2E runs against a throwaway Supabase user created in `e2e/global-setup.ts`
(deleted afterwards) — that is why running it against production is safe.
For local runs: `npm run build`, then `npx next start -p 3100`. Two known
flakes, both environmental: `JWT issued at future` (sandbox clock skew) and
Supabase auth rate limits after many logins — retry before investigating.

## Where things are

- `src/hooks/useTrackerData.ts` — the heart: load, offline boot, optimistic
  local state, diff-and-sync, realtime, retry, IndexedDB snapshots.
- `src/lib/trackerSync.ts`, `trackerRows.ts` — diffing and row⇄object mapping.
- `src/lib/taskLogic.ts` / `taskDisplay.ts` — dates, recurrence, sorting.
- `src/app/NewTracker.tsx` — composition root; desktop layout vs mobile shell.
- `src/components/tracker/*` — one panel/card/modal each.
- `src/lib/botPipeline.ts` — what the bot DOES with a message (shared by both
  messengers). `botTransport.ts` + `telegram.ts` + `max.ts` — how it is sent.
  `botDelivery.ts` — who to send to. `colleagues*.ts` — colleague messages,
  buttons and their permission checks.
- `src/lib/quickAdd.ts`, `meetingNotes.ts`, `dailyBrief.ts`, `weeklyReview.ts`,
  `telegramQueries.ts`, `telegramManage.ts`, `bulkActions.ts` — the assistant.
- `src/app/api/*` — Telegram/MAX webhooks, invite/link/send, cron.
- `supabase/migrations/*` — applied with the script above, never by hand.

## Rules that were paid for with bugs

**Sync.** Local state is the truth while you are typing; the "shadow" is a
DEEP CLONE of what the database last confirmed, and the difference between
the two is the unsent work. Never store the same object in both — a shared
reference makes a change invisible to the diff and it is silently lost. This
exact bug cost a day; `snapshotList()` exists to prevent it.

**The model does not do arithmetic or facts.** Code resolves dates, counts
and names; GigaChat only rewords and classifies. Anything it writes about
data is checked against the data (`factGuard.ts`, `rewriteIsFaithful`) and
dropped if it drifted. Never let it invent an assignee: names are resolved
against the real list (`resolveKnownName`).

**Anything destructive is confirmed first.** Bulk moves, task lists parsed
out of a dictated meeting, deletions — shown, then created only on «да».
Everything destructive in the UI leaves an undo toast.

**RLS.** Every user table needs `user_id uuid default auth.uid()` or client
inserts are rejected (this silently broke `sync_errors` for weeks). The
service-role client bypasses RLS entirely, so server code must filter by
`user_id` itself. `npm run test:rls` is the guard.

**Server-to-server routes** must be listed in `src/lib/supabase/middleware.ts`
or the session middleware redirects them to /login and they answer 405 with
nothing in the logs.

**Service worker** (`public/sw.js`): network-first for navigations,
cache-first for `/_next/static`, never caches "/" at install (it redirects to
/login and a redirected response cannot answer a navigation), and is disabled
and unregistered in development — a stale dev chunk once looked exactly like
a broken feature.

**Mobile internet may not reach `*.supabase.co`** even when the site loads.
The browser client probes the direct host once and falls back to the `/sb`
rewrite on our own domain (`next.config.ts`), remembering the choice.

**Russian hosts need a root CA the server does not have.** `*.max.ru` and
GigaChat are signed by the Ministry of Digital Development's root, which a
Russian Windows machine trusts and a Vercel function in fra1 does not. So
these calls work from here and fail there — the most misleading shape a bug
can have — and Node reports it as the two words «fetch failed», naming
nothing. `russianCa.ts` holds the root (from `certs/`) and hands out both an
`https.Agent` and a fetch-shaped `russianFetch`; anything talking to a
Russian service goes through it, and its errors unwrap `cause` so the reason
is legible. This cost an afternoon disguised as «MAX не принял этот токен».

**React compiler lint is on.** No setState inside an effect (derive during
render, or `useSyncExternalStore` for browser state); no mutating a value
after a hook has captured it.

**Touch.** HTML5 drag-and-drop does not exist on a phone. Every drag has a
button equivalent (`ActionMenu`, the card's ⋮, the thought's ⇢). A floated
element is painted under the neighbouring block's text — that is why the
toast × was unclickable; keep tap targets ≥36px and positioned, not floated.

**Windows/Git Bash:** heredocs eat backslashes, so a patch script written
with `cat <<'EOF'` mangles `\n` and regexes — use the Write/Edit tools for
anything containing a backslash. `next build` fails on `.next` files locked
by a running `next start` (and by OneDrive) — stop the server first.

## Open threads

- **The tracker is multi-user now.** Fourteen managers who sign in by
  invitation, tasks with several executors who each report for themselves,
  meetings that are voted on, a thread inside every item. Every decision
  behind it is written down in `docs/multiuser.md` (in Russian, because they
  are his words) along with what is done and what is not: read that before
  touching anything about people, roles or participation, and do not
  re-litigate what is settled there. Migration 0019 is applied.
- **Participation lives outside the sync engine, on purpose.**
  `useTaskParticipants`, `useMeetingVotes` and `useItemComments` read and
  write their tables directly; `useTrackerData`'s optimistic diff owns only
  the columns in `taskToRow`/`meetingToRow`, and anything else written to
  those tables (approval_state, vote_round) must stay out of them. A task
  saved locally does not exist in Postgres yet — anything attaching a row to
  a fresh task or meeting has to wait for it, or the foreign key silently
  eats the row.
- **MAX is connected from inside the tracker, not from Vercel.** `/max` is a
  page he can be handed as a link: he pastes the token the MAX for business
  cabinet (business.max.ru) gave him — MasterBot stopped creating bots in
  September 2026 — and `/api/max/setup` checks it, reads the bot's @username,
  invents the webhook secret, subscribes the webhook and stores all of it in
  `bot_settings` (migration 0022, one row per install). Everything
  server-side reads the token through `maxSettings()` — env vars still win,
  so a local run stays controllable from `.env.local` — and the browser
  learns the bot exists through `useMaxBot()`. The token is not merely
  policy-protected: column privileges on `bot_settings` mean PostgREST
  cannot select it at all, and `npm run test:schema` proves it.
  Migration 0022 is the one migration that **applies itself**: the setup
  route notices the table is missing and runs the same DDL over
  `DATABASE_URL` (`ensureBotSettings.ts`, fixed and idempotent — never
  arbitrary SQL, and a test keeps the embedded copy identical to the file).
  Otherwise connecting a bot would have meant a trip to the SQL editor
  first, which is the same wrong answer in a different panel.
  The reason it is not three Vercel environment variables is the rule at the
  top of this file: that is four screens of somebody else's control panel.
  **Connected for real on 14.09.2026**: «РОКАС Трекер» `@id6168118162_4_bot`,
  under ООО «РЕГИОН КАСС» at business.max.ru/self/chat-bots (dev.max.ru is
  documentation only). A new bot sits «на модерации» for up to a day and its
  Настройки tab — where the token is — stays disabled the whole time, so an
  empty token there means «not approved yet», not «broken». Two things bit on
  the way in and would bite again: Vercel has **no `DATABASE_URL`**, so the
  self-applying migration could not apply itself and 0022 went in with
  `scripts/run-migration.mjs` from here; and every call to MAX failed on the
  root CA (see the rule above). Editing a published bot sends it back through
  moderation, which is why the mini-app link is not set yet.
- Colleagues are recipients, not users. Making them real users who exchange
  items with each other is his own next big idea, deliberately deferred.
- Offered and not yet decided: sending a task to Telegram automatically when
  an assignee is set (today it is the ✈ button).
- Known gaps: the nightly backup goes to Telegram only (MAX file upload not
  implemented); voice notes in MAX are transcribed only if they arrive as
  OGG/Opus.

Environment (Vercel + `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
`GIGACHAT_AUTH_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
`TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`. The three MAX ones
(`MAX_BOT_TOKEN`, `MAX_WEBHOOK_SECRET`, `NEXT_PUBLIC_MAX_BOT_USERNAME`) are
optional overrides now — normally MAX is connected on `/max` instead.
