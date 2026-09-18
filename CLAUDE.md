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
                      # NOTE: needs a local postgres, so it does NOT run on
                      # his Windows machine. It runs in CI on every push
                      # instead (.github/workflows/ci.yml) — that is where
                      # to look when it fails, and the failure is echoed
                      # into the run's annotation because job logs are
                      # invisible to anyone not signed in to GitHub.
npm run test:bots     # drives both messenger webhooks end to end
npm run test:workspace  # owner + two throwaway managers against production:
                      # invite, join, a task on two people, review, return,
                      # refusal, meeting revote, idea→task, discussion,
                      # access revoked. 60 checks. Written 15.09.2026 because
                      # nothing covered any of this.
node --env-file=.env.local scripts/check-assignments.mjs [--fix]
                      # tasks and meetings that LOOK assigned and are not.
                      # Worth running weekly: it is what caught the bot
                      # assigning nobody while replying «Исполнитель: Игорь».
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
- `src/components/Ask.tsx` — единственное окно вопроса: `ask` / `confirm` /
  `say` / `choose`. Системных `prompt/confirm/alert` в трекере нет.
- `src/components/tracker/ChipChoice.tsx`, `PeoplePicker.tsx` — выбор
  кнопками: поля формы и люди с ролями. `src/lib/peopleOrder.ts` — порядок
  людей во всех списках. `Dropdown.tsx` — список там, где кнопок вышла бы
  стена (фильтр по исполнителю, роль участника); своей разметкой, не
  системный `<select>`. `Icon.tsx` — все значки интерфейса.
- `src/hooks/useEscapeToClose.ts` — Esc закрывает то, что открыто. Одно
  место на все окна и меню.
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

**Two truths about one fact always drift apart.** The audit of 15.09.2026
found the same shape three times: a name in `tasks.assignee` beside a row in
`task_participants`, a list of names in `meetings.participants` beside
`meeting_participants`, `tasks.accepted_at` beside the executors' own
`accepted_at`. Each pair had diverged — two tasks assigned to nobody, 26
meetings of 28 inviting nobody, a card reading «✅ принял» after one of four.
Migration 0024 makes the first two structural: a name that matches a real
person creates the row itself, only when there is none and only when the name
actually changed. The trigger cannot send a message, so `assignExecutors.ts`
still exists — it assigns AND tells the person, and the trigger is the net
under it. Before adding a third way to say the same thing, don't.

**An answer goes through the route, and only through it.** The rules that
make a report a report — a mandatory comment, a mandatory reason, the move to
приёмка, telling the person who asked — live in `/api/workspace/report`. The
database used to allow a manager to write those same rows straight from the
browser, which is the same as not having the rules. Migration 0023 removed
that: reading stays, answering is the route's alone. Adding a new way to
answer means adding it to that route, not beside it.

**The history of an item lives in its own discussion.** Sending work back
for rework clears the reports (`done_at`, `done_comment`) — it has to, or the
task stays «отчитались все» forever. That erases the very thing people ask
about afterwards: what was handed in the first time and what exactly was
asked for. So every event that moves a task writes a line into its
discussion, marked `system` (migration 0026): accepted, reported, refused,
asked to move, approved, returned, force-closed. Not a new events table —
that would be a third truth about one fact, and the discussion already has
time, visibility and messenger delivery. System lines cannot be edited, take
no reactions, are not counted as «в обсуждении писали», and the write policy
refuses `system = true` from the browser outright. Write them in BOTH paths
(`/api/workspace/report` and `colleagueReplies.ts`) or the two will drift.
Text and deadline edits deliberately do NOT go there: they change often and
through the sync engine, and a line per keystroke turns the history into a
feed nobody reads.

Под самим сообщением не написано ничего. Всё, что с ним можно сделать —
реакции, «Изменить», «Убрать», «Копировать текст», — живёт в меню по правой
кнопке (`ChatMessageMenu.tsx`), на телефоне оно же по долгому нажатию (450 мс,
движение пальцем отменяет — иначе меню открывается при каждой прокрутке).
Так просил Кирилл, «по аналогии с телеграм», и он прав: строка «☺ изменить
убрать» под каждой репликой — это ветка, которую читаешь через подписи к ней.
Реакции, которые уже стоят, остаются видимыми под сообщением; пустая строка
не рисуется вовсе. Набор эмодзи фиксирован (`REACTIONS`) по прежней причине —
реакция уезжает в мессенджер строкой под сообщением.

**PostgREST batch inserts do not fall back to column defaults.** Insert an
array where one object omits a key another object has, and that row gets
NULL rather than the default — so a `not null default false` column blows up
the whole batch with 23502. Every row in one `.insert([...])` must carry the
same keys. This cost half an hour of looking for a policy problem that was
not there.

**React compiler lint is on.** No setState inside an effect (derive during
render, or `useSyncExternalStore` for browser state); no mutating a value
after a hook has captured it.

**Touch.** HTML5 drag-and-drop does not exist on a phone. Every drag has a
button equivalent (`ActionMenu`, the card's ⋮, the thought's ⇢). A floated
element is painted under the neighbouring block's text — that is why the
toast × was unclickable; keep tap targets ≥36px and positioned, not floated.

**The answer belongs where the button is.** A result printed once at the
bottom of a long list — the invite link in «Команда» — is produced, rendered,
and never seen: fourteen people put it a screenful below the button that was
pressed, and «не даёт ссылку» meant exactly that and nothing else. The same
goes for the error, which is worse: it is the only explanation of what just
happened. Render both beside the row they answer, and pull them into view.

**Каждый сантиметр экрана — рабочий.** Его слова, сказанные как правило: «хочу,
чтобы каждый сантиметр использовался рационально — и в моём рабочем поле, и в
поле подключённых сотрудников». Поэтому в трекере нет надписей, которые
называют очевидное: строки «КАЛЕНДАРЬ» и «ЗАДАЧИ» над календарём и над
задачами убраны, а ручка перетаскивания панели переехала в первую же рабочую
строку. Нет и кнопок, повторяющих то, что и так происходит: «+» рядом с полем
мысли не было нужно — надиктованная сохраняется сама, набранная по Enter.
Прежде чем добавить заголовок, подпись или кнопку, ответьте, что нового она
говорит; если ничего — её не должно быть.

**Ничего в интерфейсе не рисует чужой шрифт и чужая система.** Правило
18.09.2026, названное Кириллом тремя словами подряд: «колхозный шрифт»,
«позапрошлый век», «как в программе 1995 года». Три источника этого вида, и
все три закрыты:
*Шрифт* — один на весь трекер (Manrope, `--sans`). Моноширинный `--mono`
стоял не на коде, а на подписях: заголовки блоков, названия полей, даты,
время встреч; в этой роли Consolas и читается «Блокнотом». Он остался ровно
в трёх местах, где моноширинность значит моноширинность: код приглашения,
ссылка и `<code>`. Выравнивание цифр в столбик даёт
`font-variant-numeric:tabular-nums`, а не отдельный шрифт. Подписи набраны
`--label-size`/`--label-weight`/`--ink-label` — не выдумывайте размер на
месте.
*Значки* — контурные SVG из `Icon.tsx`, а не эмодзи. Эмодзи рисует система:
на Windows это цветная наклейка из Segoe UI Emoji, своего размера и своего
цвета, который не меняется вместе с кнопкой. В строках, которые уходят в
Telegram и MAX (`lib/colleagues.ts`, `telegramQueries.ts`, `api/workspace/*`),
эмодзи остаются — там их рисует мессенджер, и это правильно.
*Списки* — свои (`Dropdown.tsx`). Раскрытый `<select>` принадлежит
операционной системе целиком: белая полоса поверх тёмного окна, чужой шрифт,
чужие отступы. Если добавляете выбор — сначала кнопки (`ChipChoice`), и
только когда их вышла бы стена — `Dropdown`.

**Ничто не всплывает поверх кнопок.** Календарь в форме задачи раскрывается
В ПОТОК (`.mini-cal-inline`, `order:99`), раздвигая форму, а не ложась на
соседний ряд. Всплывающим он неизбежно накрывал «Сегодня / Завтра / Через
неделю» наполовину — и это ровно то, что Кирилл назвал «кнопки залазят друг
на друга». Плотный фон и тень эту задачу не решают: половина кнопок всё
равно торчит сбоку. Строка, которая может не поместиться, — сетка с
именованными ячейками (`.team-row`), а не общий `flex-wrap`: перенос рвёт
такой ряд в произвольном месте, и у четырнадцати человек подряд это выглядит
как «кнопки гуляют как хотят».

**Esc закрывает то, что открыто, — везде.** `useEscapeToClose`, один хук на
все окна и меню. Раньше обработчик каждое окно заводило себе само, и потому
«Команда» его просто не завела. Хук слушает в фазе ПЕРЕХВАТА и останавливает
событие: окна вкладываются друг в друга, и один Esc должен закрывать верхнее,
а не всю стопку. Исключение одно — `Ask.tsx`: он смонтирован в корне раньше
всего, что его вызывает, и держит свой обработчик.

**Задача без исполнителя не заводится.** Слова Кирилла: «без исполнителя
запрети создавать», соисполнитель и наблюдатель — по желанию. Проверка стоит
в `save()` формы и на создании, И на правке: снять единственного исполнителя
и нажать «Сохранить» — тот же результат в два нажатия, а запрет, который
обходится в два нажатия, не запрет. Поле говорит об этом само («нужен
исполнитель» у метки), а не только в момент отказа. Оттуда же и шаг
`pickAnyExecutor` в `e2e/helpers.ts`: без него ни один тест больше не заведёт
задачу.

**`dragend` не приходит элементу, которого уже нет.** Карточка, брошенная в
ДРУГОЙ столбец, меняет `term` и перерисовывается в другом списке раньше, чем
браузер пошлёт ей `dragend`, — класс `.dragging` остаётся, и задача на новом
месте стоит полупрозрачной и повёрнутой на полградуса («побледнела и криво
встала»). Внутри одного столбца этого не видно, потому что элемент остаётся
на месте. Снимайте состояние перетаскивания И в `handleDrop`, И глобальным
слушателем на `document` — он приходит всегда.

**Вопрос задаёт трекер, выбор делается кнопками.** Ни `prompt`, ни `confirm`,
ни `alert`: чужое системное окно нельзя ни объяснить, ни проверить, а на
телефоне во встроенном браузере мессенджера оно может не показаться вовсе —
и кнопка тогда просто «не работает». Всё спрашивает `components/Ask.tsx`.
Выбор из нескольких — кнопки (`ChipChoice`), а не выпадающий список: список
это пять действий и обязательное чтение там, где вариантов два. Списками
остаются только те, где кнопок вышла бы стена (число месяца). Люди во всех
списках идут в одном порядке — `lib/peopleOrder.ts`, он продиктован Кириллом
и сортируется по фамилии, потому что имя стоит то впереди, то позади.

**Принято — значит закрыто, и закрывает это маршрут.** `/api/workspace/review`
пишет `status: done` той же записью, что и приёмку. Раньше статус переключала
вкладка сразу после ответа маршрута — и эхо realtime, вернувшееся с серверной
строкой, стирало это переключение вместе с ещё не отправленным «сделано».
Вкладка тоже ставит done у себя, но обе стороны говорят одно и то же, а
значит перезаписать друг друга не могут. Любое серверное изменение колонки,
которой владеет синхронизация, должно быть устроено так же — или не быть.

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
  root CA (see the rule above).
- **The mini-app link is deliberately empty.** It would be
  `https://task-tracker-beta-ebon.vercel.app` with the «Открыть» button, and
  the cabinet says plainly that editing a published bot requires moderation
  again — the documentation nowhere says whether the bot keeps answering
  while that runs, and neither does the platform. He was asked on 14.09.2026
  and chose to live with the bot first and add the mini-app when a day of
  silence would not hurt. Do not set it on your own initiative.
- Colleagues are recipients, not users. Making them real users who exchange
  items with each other is his own next big idea, deliberately deferred.
- **The morning brief is facts first, model second.** GigaChat writes the
  prose part; everything with a name or a number in it is appended
  afterwards in code — what is waiting for his приёмка, who has not answered
  at all (`silence.ts`), what was discussed since yesterday, and on Mondays
  what looks assigned but is not. That order is the rule, not the habit: the
  model may reword, it may not count.
- «Не ответили на задачу» and «задача не дошла» are two blocks on purpose. A
  person with no messenger and no login has no button to press, and calling
  that silence is both untrue and the fastest way to make the whole brief
  unreadable. On 15.09.2026 all four «silent» people were exactly that.
- Sending a task to the assignee at the moment of assignment is **done**, not
  pending — `assignWork.ts` treats it as one of the three notifications that
  cannot be switched off. The ✈ button stayed for «покажи это ещё и Ане».
  What that send SAYS («не подключён», «получит утром») has to reach the
  screen: `assignPerson` returns it, `attachOnCreate` collects it, and the
  card shows «📭 не подключён — задача не ушла» in place of «ждём ответа»
  for good. Four of his six people have no messenger, so this is not an edge
  case — it is the normal state of most rows.
- Known gap, and it is smaller than it sounds: a voice note is transcribed
  only if it arrives as OGG/Opus, in either messenger. That is what both
  messengers' own recorders produce — the format that is refused is a
  forwarded music file, and the bot says so rather than failing silently.
  Closing it means shipping a second WASM decoder into the same serverless
  function whose loading story already fills half of `speechToText.ts`; that
  is a bad trade for forwarded MP3s, so it is a decision, not an oversight.

Environment (Vercel + `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
`GIGACHAT_AUTH_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
`TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`. The three MAX ones
(`MAX_BOT_TOKEN`, `MAX_WEBHOOK_SECRET`, `NEXT_PUBLIC_MAX_BOT_USERNAME`) are
optional overrides now — normally MAX is connected on `/max` instead.
