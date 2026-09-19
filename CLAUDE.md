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

- **Everything he reads is in Russian.** Answers, reports, questions,
  what you tell him you did — по-русски, from the first line, without being
  reminded (he asked for this outright: «по русски»). English stays where he
  never looks: the code, the comments in it, the commit messages. An answer
  he has to translate is work handed back to him, which is the same failure
  as the rule below.
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
                      # access revoked, граница миграции 0031, потерянный
                      # доступ (ссылка на новый пароль и «забыли пароль»).
                      # 101 проверка.
                      # Written 15.09.2026 because nothing covered any of this.
node --env-file=.env.local scripts/check-assignments.mjs [--fix]
                      # tasks and meetings that LOOK assigned and are not.
                      # Worth running weekly: it is what caught the bot
                      # assigning nobody while replying «Исполнитель: Игорь».
node --env-file=.env.local scripts/run-migration.mjs supabase/migrations/00NN_x.sql
node --env-file=.env.local scripts/max-setup.mjs https://<deployment>   # MAX webhook, fallback for /max

cd desktop && npm install   # оболочка для ПК, свои зависимости (Electron)
cd desktop && node smoke.mjs # окно: вход без сессии, офлайн-страница
cd desktop && npm run dist   # собрать установщик локально, dist/*.exe
git tag v1.0.1 && git push origin v1.0.1   # выпустить новую версию оболочки
```

E2E runs against a throwaway Supabase user created in `e2e/global-setup.ts`
(deleted afterwards) — that is why running it against production is safe.
For local runs: `npm run build`, then `npx next start -p 3100`. Two known
flakes, both environmental: `JWT issued at future` (sandbox clock skew) and
Supabase auth rate limits after many logins — retry before investigating.
Третьего не осталось: прогон идёт в ОДИН воркер (`playwright.config.ts`),
потому что тестовый аккаунт на весь прогон один и параллельные тесты
топтали строки друг друга. Пока не появится аккаунт на воркера,
`workers: 1` — это не настройка скорости, а условие осмысленности: тест,
падающий в общем прогоне и проходящий в одиночку, читается как регрессия и
съедает час на её поиски.

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

**Ответ с перенаправлением нельзя отдать на навигацию — и это ломает СНАЧАЛА
установленное приложение.** `fetch()` сам проходит по редиректу и возвращает
ответ с флагом `redirected`, а браузер такой ответ на навигацию ОТВЕРГАЕТ. В
обычной вкладке этого можно не заметить годами — там воркер может быть не
зарегистрирован вовсе, и навигацию никто не перехватывает; а приложение с
панели задач показывает свою пустую страницу ошибки, и следующее открытие
делает ровно то же: адресной строки в нём нет, выхода изнутри тоже.
Кирилл написал «приложение не открывает трекер» 19.09.2026, когда тот же
адрес в браузере работал. «/» уводит на `/login` ровно в тот момент, когда
кончилась сессия, то есть рано или поздно у каждого установленного
приложения. Правило было записано в самом `sw.js` дважды — и оба раза
применено к тому, что кладётся В кэш и достаётся ИЗ кэша, но не к живому
ответу на обратном пути. Теперь воркер отдаёт настоящий редирект на адрес,
куда fetch реально приехал (`/login` отвечает 200 сам, второго прыжка нет).
Оттуда же два соседних правила: навигация, закончившаяся на странице входа,
не становится офлайновой копией «/» — иначе приложение без связи
открывается на форме, которую некуда отправить; а когда сети нет и в кэше
пусто, отдаётся своя страница по-русски с кнопкой, потому что английская
страница ошибки браузера в окне без адресной строки неотличима от
«приложение сломалось». Страница при каждой загрузке просит свежую копию
воркера (`registerSW.ts`): единственный путь внутрь сломанного приложения —
вкладка браузера на том же домене, и ждать суточной проверки браузера
значит сутки мёртвого приложения после починки.
`src/lib/serviceWorker.test.ts` грузит воркер в самодельный глобальный
объект и зовёт его обработчик так же, как зовёт браузер. Это единственный
файл проекта, которого не касается ни сборка, ни один другой тест, — и
ошибку в нём нельзя увидеть чтением: ответ, который браузер отвергнет,
изнутри выглядит точно как ответ.

**`const` в теле компонента, позванный выше своей строки, убивает весь
экран — и делает это с задержкой.** 19.09.2026 трекер перестал открываться у
всех, у кого есть хоть одна задача, а моментом смерти было создание задачи.
Причина в `TasksPanel`: `const mine = ...` стоял на девяносто строк ниже
строки `tasks.some((t) => !mine(t))`, которая зовёт его ПРЯМО в теле
компонента. До своей строки `const` лежит во временной мёртвой зоне, и
рендер падал с «Cannot access 'mine' before initialization». Почти все
остальные вызовы `mine` сходили с рук, потому что идут из обработчиков и из
разметки, а те выполняются, когда тело уже дошло до конца, — падало
единственное место, звавшее его в теле.
Отсюда и отложенность, которая сбила поиск: у ПУСТОГО списка `some` не
зовёт обработчик ни разу. Новый аккаунт работал ровно до первой задачи, а
дальше не открывался вовсе — задача уже в базе и приходит на каждой
загрузке. И e2e падали все разом: первый тест заводил задачу и ломал
аккаунт, остальные приходили на сломанный.
Не увидел никто: типы не могут (имя существует и тип у него верный), 392
юнит-теста не могут (это компонент, и его ничто не рендерит), линтер не был
настроен. Поэтому сторож здесь — не тест, а правило линтера:
`@typescript-eslint/no-use-before-define` с `variables: true` и
`functions: false` (поднятые объявления функций законны и на них держится
читаемость половины компонентов). Оно ловит весь класс разом, в каждом
файле, включая стрелку в `const`, которая ломается молча.
Вывод, стоивший половины дня втроём: **минифицированный стек лжёт о месте,
но не лжёт о моменте.** Имя переменной там `eL`, файл — чанк, в стеке React
и `Array.some`, и полдня ушло на статику, кэши и сервис-воркер. Ответ дало
поведение: падает при первой задаче, на пустом аккаунте нет. Сначала
ответьте, ПРИ КАКОМ УСЛОВИИ падает, и только потом лезьте в чанки; если
всё-таки лезть — dev-сборка называет настоящий файл и настоящее имя.

**Строку участия заводит либо триггер, либо код — но вставка всё равно
одна.** Тем же днём вскрылось, что создание задачи отвечает 409 всегда.
Триггер миграции 0024 пишет строку в `task_participants` вместе с самой
задачей, если в поле «Исполнитель» стоит имя настоящего человека, а
`assignPerson` следом вставлял тот же ключ второй раз — при живом
`unique (task_id, assignee_id)` (миграция 0019). Спало это до тех пор, пока
задачу можно было завести без исполнителя: тогда триггер молчал у половины
задач. Проверять «есть ли уже строка» из браузера бессмысленно — строка
триггера доедет позже realtime'ом, и проверка всегда опаздывает. Решает
база: `upsert` с `ignoreDuplicates`. Именно ignoreDuplicates, а не смена
роли: конфликт означает «строка уже есть», а не «назначать не надо», и
понижать соисполнителя до исполнителя он не повод. Сообщение человеку
уходит в любом случае — триггер писать в мессенджер не умеет, ради этого
`assignWork.ts` и существует.

**Настольное приложение — это окно вокруг боевого сайта, а не его копия.**
`desktop/` (Electron, свой `package.json`, основного проекта не касается):
`main.js` открывает `task-tracker-beta-ebon.vercel.app` и добавляет ровно то,
чего не хватает вкладке, — иконку, единственное окно, память о размере,
внешние ссылки в системный браузер и русскую страницу «Нет связи» на первый
запуск без интернета, когда воркера ещё нет. Слова Кирилла 19.09.2026:
«чтобы все изменения при новом открытии приложения сами автоматически
устанавливались». Копия внутри приложения означала бы релиз на каждую
правку текста и четырнадцать человек, которые его ставят; окно вокруг сайта
означает, что правка уже там при следующем открытии. Поэтому НЕ кладите сюда
ни сборку Next, ни бизнес-логику: всё, что делает трекер, живёт на сайте.
Обновляется сама оболочка (меняется несколько раз в год) через GitHub
Releases — репозиторий публичный, токен в приложение не уезжает; тихо,
загрузкой в фоне и установкой при выходе, потому что окно программы — не
повод для диалога. Выпуск: поднять `version` в `desktop/package.json`, тег
`vX.Y.Z` — дальше `.github/workflows/desktop.yml` собирает установщик на
Windows-машине GitHub и публикует релиз. Собирать у себя не нужно и не на
чем: Rust и Visual Studio Build Tools на машине Кирилла нет, и это же
причина, по которой выбран Electron, а не Tauri. Проверяется оболочка
`node smoke.mjs` — Playwright поднимает окно и смотрит два состояния,
которые браузером не проверить: вход с кончившейся сессией (должна быть
форма входа, а не пустой экран — у окна нет адресной строки, как и у
установленного PWA) и запуск без сети. **Первый релиз выпущен 19.09.2026: v1.0.1**
(github.com/Kirill900504/task-tracker/releases) — там же постоянная ссылка
на установщик, которую можно давать людям. Две вещи из этого выпуска,
которые повторятся у следующего:
*npm 11 не выполняет install-скрипты без разрешения*, и разрешение в
`desktop/package.json` (поле `allowScripts`) пиннуто к точной версии.
Обновление lock-файла молча оставляет Electron без бинарника — `npm ci`
отрабатывает за двенадцать секунд, а падает потом, внутри
electron-builder. Поэтому в workflow стоит явный
`node node_modules/electron/install.js`, безвредный, когда бинарник уже на
месте.
*Логи Actions требуют прав администратора на репозиторий*, то есть тому,
кто ждёт установщик, они не видны вовсе. Поэтому ошибка сборки печатается
аннотацией `::error::` — аннотации API отдаёт публично. Тот же приём уже
был у schema-теста в ci.yml; если добавляете шаг, который может упасть,
добавьте и это.
*Тег одноразовый*: сборка, упавшая до публикации, оставляет тег, который
указывает на релиз без файлов. Не перезаписывайте его — поднимайте версию.
Установщик не подписан: Windows
покажет «Windows защитила ваш компьютер» → «Подробнее» → «Всё равно
выполнить». Сертификат подписи кода стоит денег и решается Кириллом; пока
этого нет, предупреждайте об этом окне, а не делайте вид, что его не будет.

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

**Трекер сам говорит, что сломался.** 19.09.2026 он дважды падал в белый
экран, и оба раза мы узнали об этом из сообщения Кирилла — между поломкой и
починкой стояли его свободное время и фраза «вылетает эта ошибка».
Теперь падение ловится и записывается: `global-error.tsx` (падение
отрисовки) и `CrashWatch.tsx` (всё, что до React не долетает — обработчики,
промисы, сеть) зовут `lib/reportCrash.ts`, тот шлёт строку в
`/api/client-error`, маршрут пишет её в `client_errors` (миграция 0035) и
говорит владельцу в мессенджер.
Что здесь важно не сломать:
*Пишет только маршрут, служебным ключом.* Политик на вставку у таблицы нет
вовсе. Причина — форма самой частой аварии: интерфейс падает не одной
ошибкой, а циклом, и браузер с политикой на вставку залил бы таблицу
сотнями строк в минуту. По той же причине в маршруте стоит предел (пять
строк в минуту на человека), а в браузере — память об уже отправленном.
*Владельцу — один раз на поломку, а не на каждого, кто в неё упёрся*
(`shouldNotify`, час тишины на отпечаток). Отпечаток режется из текста
ошибки с вырезанными адресами, числами и идентификаторами
(`fingerprintOf`), иначе одна поломка у четырнадцати человек даёт
четырнадцать разных.
*Экран восстановления — часть механизма, а не украшение.* То, что видел
Кирилл, было страницей браузера «This page couldn't load»: ни слова
по-русски, никакого объяснения и — в установленном приложении, где нет
адресной строки, — никакого выхода. Вместо неё теперь своя страница: что
случилось, что данные целы, кнопка «Открыть заново».
*Sentry сюда не нужен*, и это решение, а не бедность: сторонний сборщик —
это чужой аккаунт и четыре экрана чужих настроек (правило «две кнопки и
пароль»), плюс тексты ошибок содержат куски данных, которые незачем
увозить. Своя база уже есть, и она под теми же ключами, что остальное.

**Написанное в обсуждении обязано до кого-то дойти.** Полгода не доходило
ни до кого: отправка из трекера просто клала строку в базу, а утренняя
сводка владельца считала только сообщения из мессенджера
(`author_user_id is null`) — двое могли переписываться в одной задаче и
оба считать, что второй молчит. Кому сказать — правило, и живёт оно в
`commentDelivery.ts`: участники итема плюс владелец, минус автор. Порог
общий на оба пути — первое сообщение после двухчасовой паузы уходит сразу,
остальные приходят строкой «💬 Писали в обсуждениях» в утренней сводке
(она есть теперь и у руководителя, `managerBrief.ts`). Вставку по-прежнему
делает браузер: с текстом уезжают файлы прямо в корзину, а задача, ещё не
доехавшая до облака, требует подождать её и повторить, — маршрут
`/api/workspace/comment` только проверяет авторство и зовёт рассылку.
Служебные строки (`system`) не рассылаются: о них уже сказал тот маршрут,
который их написал.

**Ссылку Supabase на наш домен не возвращает — её собираем сами.**
`generateLink` и `resetPasswordForEmail` кладут в письмо адрес вида
`<проект>.supabase.co/auth/v1/verify?...&redirect_to=<наш адрес>`, и этот
`redirect_to` МОЛЧА заменяется на Site URL проекта, если наш адрес не внесён
в список разрешённых в чужой панели. В этом проекте он не внесён: проверка
19.09.2026 вернула `redirect_to=http://localhost:3000`. То есть человек,
открывший такую ссылку, уезжает на пустой localhost, и выглядит это как
«ссылка не работает», а не как настройка. Поэтому `/api/workspace/access-link`
берёт из ответа `properties.hashed_token` и собирает адрес сам — на нашем
домене, — а `/reset-password` меняет токен на сессию через `verifyOtp` и
сразу вычищает его из адреса. Ничего настраивать для этого не нужно, и
человек видит знакомый адрес трекера. Письмом это не чинится вовсе: текст
письма собирает сам Supabase, и пока Site URL проекта — localhost, любое его
письмо ведёт в никуда (Authentication → URL Configuration, чужая панель).
Поэтому «Забыли пароль?» на странице входа больше не шлёт письма: она зовёт
`/api/workspace/forgot-password`, и ссылка уходит человеку В МЕССЕНДЖЕР, в
тот же чат с ботом, куда приходят задачи. Маршрут отвечает всем одинаково —
по ответу нельзя узнать, есть ли такая почта в трекере, — а что делать, если
ссылка не пришла (мессенджер не привязан), страница говорит сама. Он
публичный, значит стоит в списке исключений `supabase/middleware.ts`.

**Потерянная ссылка на трекер выдаётся заново, а приглашение — нет.**
Приглашение (`/api/workspace/invite`) работает один раз и после «уже в
трекере» отвечает отказом — правильно: вторая такая ссылка завела бы
человеку ВТОРОЙ аккаунт, а его отчёты, комментарии и участие остались бы у
первого. Но ссылку теряют и пароль забывают, и до этого строка «в трекере»
в «Команде» была тупиком без единой кнопки. Второй маршрут —
`/api/workspace/access-link` — выдаёт владельцу одноразовую ссылку на смену
пароля ДЛЯ ТОГО ЖЕ входа плюс почту, под которой человек записан: увидеть
её в трекере больше негде, а без неё не войти. Кнопка называется так же,
как у приглашённого («Ссылка ещё раз»): вопрос у Кирилла один, а то, что
внутри это разные маршруты, его не касается. Пароль назначает человек, а не
владелец, — иначе его знали бы двое и «это писал не я» стало бы
неразрешимым.

**Ответ из мессенджера адресуется, а не угадывается.** Кнопка «💬 Ответить»
под задачей пишет намерение в три колонки на строке человека (миграция
0028) и живёт два часа; следующее сообщение идёт туда и намерение
снимается. Угадывание «по самой свежей открытой задаче» осталось запасным
путём и вслух предлагает поправить себя. Порядок разбора текста от коллеги
менять нельзя: сперва незакрытый вопрос (ждём отчёт или причину), потом
намерение, и только потом слово-команда — иначе «сегодня», написанное в
ответ на «что именно сделано?», уедет списком дел, а человек останется с
отчётом без единого слова.

**У коллеги в боте есть свои команды** (`colleagueQueries.ts`): «мои
задачи», «сегодня», «просрочено», «встречи», «на приёмке», «помощь» —
выборки по его строкам участия, не по пространству. Совпадение точное, как
и у владельца: «сегодня» внутри фразы — слово, а не команда. Списки
отдаются кнопками, `t:show:<id>` открывает карточку со всеми действиями,
`t:list:my` и `m:list:my` — переход между списками. Проверяется это на
боевом: `npm run test:bots -- https://task-tracker-beta-ebon.vercel.app`.

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

**Кнопки «Сбросить расположение» больше нет.** Его слова 19.09.2026:
«не понимаю смысл кнопки… конструктор должен легко меняться, чтобы эта
кнопка вообще не требовалась, а ты сделал через жопу этот функционал, и
кнопку воткнул, чтобы на крайний случай до базового уровня откатывать».
Он прав: кнопка страховала конструктор, из которого трудно было выбраться —
пустая боковая зона схлопывалась в ноль и вернуть в неё панель было нечем.
Поэтому чинился конструктор: во время перетаскивания пустая зона
раскрывается в полосу и принимает панель обратно. Прежде чем добавлять
кнопку отката к чему бы то ни было, спросите, почему оттуда трудно выйти.

**Каждый сантиметр экрана — рабочий.** Его слова, сказанные как правило: «хочу,
чтобы каждый сантиметр использовался рационально — и в моём рабочем поле, и в
поле подключённых сотрудников». Поэтому в трекере нет надписей, которые
называют очевидное: строки «КАЛЕНДАРЬ» и «ЗАДАЧИ» над календарём и над
задачами убраны, а ручка перетаскивания панели переехала в первую же рабочую
строку. Нет и кнопок, повторяющих то, что и так происходит: «+» рядом с полем
мысли не было нужно — надиктованная сохраняется сама, набранная по Enter.
Прежде чем добавить заголовок, подпись или кнопку, ответьте, что нового она
говорит; если ничего — её не должно быть.

**Выгрузки в трекере нет, и это решение, а не пропуск.** 19.09.2026 он
спросил про кнопку «Выгрузить» прямо: «зачем вообще нужна кнопка
„выгрузка“??? Я не предполагаю никуда выносить ничего». Кнопка в шапке,
меню JSON/CSV и `lib/exportData.ts` удалены целиком. Данные при этом не
заперты: еженедельная резервная копия JSON уходит ему и каждому коллеге в
мессенджер (`api/cron/backup`), и это ровно то, ради чего кнопку обычно
держат. Второе устройство — не повод её возвращать: трекер ставится на
любой ПК кнопкой «Установить» (PWA, `useInstallPrompt`), и данные приезжают
туда входом в тот же аккаунт, а не файлом. Если экспорт когда-нибудь
понадобится — спрашивать надо его, а не возвращать кнопку «на всякий
случай».

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

**Назначенная встреча — договорённость, а не черновик.** У сохранённой
встречи название, дата, время и состав не редактируются: их показывает
сводка (`.meeting-facts`), полей нет вовсе, и `save()` берёт эти четыре
значения из самой встречи, а не из состояния формы — чтобы одна будущая
кнопка не отменила запрет молча. Причина не в аккуратности: о встрече уже
сообщили всем, кого она касается, и по ней уже проголосовали, а тихая правка
времени у себя в окне не меняет ни того, ни другого — она разводит то, что
люди видели, и то, что записано. Слова Кирилла: «в моменте не подлежит
изменению, изменения и дополнения участниками возможны только при дальнейшем
переносе». Меняется это переносом, и путей к нему два: быстрый ⇢ в списке
(дата и время, состав как был — для «сдвинуть на завтра») и кнопка в самой
встрече, которая открывает форму НОВОЙ встречи с тем же составом, где можно
поправить и время, и кого зовём. Обе ветки закрывают прежнюю встречу одной
функцией `closeAsMoved` — «перенесено» это четыре поля разом плюс отмена, и
двух копий этого быть не должно.

**Перетаскивание — одно на весь трекер, на dnd-kit, и оно НЕ браузерное.**
19.09.2026 Кирилл посмотрел на прежний вид и назвал его тремя фразами:
«зажимающейся ладонью как на windows 1995», «перетаскивать почти прозрачную
тень выделенного блока», «запрещающий знак в местах куда перенести нельзя…
ЧТО НЕТ БОЛЕЕ СОВРЕМЕННОГО РЕШЕНИЯ?». Он прав по существу, и починить это
настройками было нельзя: всё перечисленное рисует встроенный в браузер HTML5
drag-and-drop — призрак и курсор принадлежат операционной системе, соседние
блоки не отзываются никак, а на телефоне этого нет вовсе. Теперь всё, что
таскают (панели, задачи, мысли, встречи), живёт в ОДНОМ `DndContext`
(`components/tracker/dnd/TrackerDnd.tsx`) на pointer-событиях. Один он не
из лени: карточки лежат ВНУТРИ панелей, а мысль несут из панели в панель, —
вложенные контексты перехватывают событие ближайшим, и половина
перетаскиваний привязалась бы не туда.
Что из этого следует для кода:
*Правило вида.* Блок поднимается под курсор целиком (`DragOverlay`), на его
месте остаётся силуэт (`.dragging` — пунктир, содержимое скрыто), соседи
расступаются. «Сюда нельзя» показывается тем, что место не уступается, а не
перечёркнутым кругом. Панель — исключение: под курсором едет плашка с
названием, потому что панель высотой в экран закрыла бы собой то место,
куда её несут.
*Кто что разбирает.* Элемент объявляет в `data.payload` вид (`panel`/`task`/
`idea`/`meeting`), зона — в `data.target` то, чем она является. Обработчик
регистрируется хуком `useDropHandler` там, где живут данные: перестановку
задач знает `TasksPanel`, день календаря — `CalendarPanel`. Обработчиков на
один вид может быть несколько, каждый фильтрует по цели — задачу бросают и
в столбец, и на день.
*Порядок считается один раз* (`lib/dndOrder.ts`) и для предпросмотра, и для
записи. Раньше это было два разных расчёта, и совпадали они только потому,
что за ними следили.
*Нажатие отделено от перетаскивания* порогом в 6 пикселей, а на телефоне —
задержкой 220 мс (иначе список нельзя прокрутить пальцем). `CardPointerSensor`
не начинает перенос с кнопок, полей и галочек — иначе выделение текста в
мысли превращалось бы в перенос. Но `[role="button"]` в этот список
добавлять нельзя: его вешает сам dnd-kit на КАЖДЫЙ перетаскиваемый
элемент, и мысли перестают браться вовсе.
*Автопрокрутка приглушена* (`threshold 0.1`): по умолчанию страница едет,
когда карточку всего лишь ведут из правой колонки в левую, и под курсором
оказывается не то, на что целились. На этом же молча падал e2e — цель
измерена до старта, а к моменту движения она уехала; поэтому `dragOnto` в
`e2e/helpers.ts` измеряет цель ПОСЛЕ начала переноса и прокручивает
источник в видимую область.
*Кнопки-дублёры остаются* (`ActionMenu`, ⋮ у карточки, ⇢ у мысли): пальцем
теперь можно и таскать, но у длинного нажатия и у списка разные права на
ошибку.

**Вопрос задаёт трекер, выбор делается кнопками.** Ни `prompt`, ни `confirm`,
ни `alert`: чужое системное окно нельзя ни объяснить, ни проверить, а на
телефоне во встроенном браузере мессенджера оно может не показаться вовсе —
и кнопка тогда просто «не работает». Всё спрашивает `components/Ask.tsx`.
Выбор из нескольких — кнопки (`ChipChoice`), а не выпадающий список: список
это пять действий и обязательное чтение там, где вариантов два. Списками
остаются только те, где кнопок вышла бы стена (число месяца). Люди во всех
списках идут в одном порядке — `lib/peopleOrder.ts`, он продиктован Кириллом
и сортируется по фамилии, потому что имя стоит то впереди, то позади.

**Экран отвечает раньше облака.** «Чат отправляет с секундной задержкой» и
«при нажатии „Команда“ тоже задержка» — одна и та же ошибка в двух местах:
действие начиналось с сети, а человеку показывали результат последним.
Отправка сообщения успевала сходить в облако ПЯТЬ раз подряд (кто я →
моя строка в списке людей → вставка → рассылка → перечитать ленту целиком
вместе с подписанными ссылками на все файлы), и только потом текст появлялся
на экране; «Команда» открывалась пустой и шла за списком, который в этот
момент уже лежал в соседнем компоненте. Отсюда три правила.
*Кто я — спрашивается один раз* (`lib/me.ts`). `auth.getUser()` — это запрос
в сеть на каждый вызов; ответ берётся из сессии, которая и так в браузере, и
живёт до смены входа. Подделать его нельзя: права в базе сверяют настоящий
`auth.uid()`.
*Справочник, нужный нескольким окнам, — один на всех* (`lib/sharedStore.ts`).
Список команды читают карточка задачи, встреча, каждая мысль в панели, меню ✈
и «Команда»; хук «загрузить при монтировании» превращал это в пять
одинаковых запросов и пять «Загрузка…». Store склеивает их в один, отдаёт
уже известное сразу и освежает фоном, а `prefetchTeam()` в корне спрашивает
список заранее — нажатие должно тратить время на ответ, а не на вопрос.
У кэша нет срока годности в обычном смысле: устаревание ловится realtime по
тем таблицам, изменение которых его и вызывает (для команды — `assignees` и
`workspace_members`), а две секунды в `FRESH_MS` держат только один всплеск
монтирований. Это не мелочь: на двадцати секундах человек, нажавший «Start»
у бота, ещё полминуты числился бы неподключённым, и кнопка «Отправить» в
задаче не появлялась бы — e2e поймал это в тот же день, когда кэш появился.
*Кнопка меняет экран, а потом базу.* Отправка, правка, удаление, реакция,
роль участника, снятая просьба о переносе, направление, отключение входа,
отвязка мессенджера — всё это рисуется сразу, запись идёт следом, и
перечитывание случается ТОЛЬКО если запись не прошла. Не путать с движком
синхронизации: он владеет своими колонками сам (см. правило про Sync), а это
короткие таблицы рядом с ним. Своё, ещё не подтверждённое сообщение лежит в
отдельном списке (`outbox`), а не вперемешку с пришедшими: лента
перечитывается целиком на каждое движение в базе, и чужое сообщение,
пришедшее в эту секунду, стёрло бы своё.

**Принято — значит закрыто, и закрывает это маршрут.** `/api/workspace/review`
пишет `status: done` той же записью, что и приёмку. Раньше статус переключала
вкладка сразу после ответа маршрута — и эхо realtime, вернувшееся с серверной
строкой, стирало это переключение вместе с ещё не отправленным «сделано».
Вкладка тоже ставит done у себя, но обе стороны говорят одно и то же, а
значит перезаписать друг друга не могут. Любое серверное изменение колонки,
которой владеет синхронизация, должно быть устроено так же — или не быть.

**Трекер один на всех, админ — только Кирилл.** 18.09.2026 он сказал прямо:
«хочу, чтобы у моих коллег был такой же интерфейс работы с таск-трекером,
как и у меня со всеми возможностями, НО ФУНКЦИЯ АДМИНИСТРАТОРА БЫЛА ТОЛЬКО
У МЕНЯ». Отдельного экрана руководителя больше нет — есть трекер, а над ним
раздел «Что от вас ждут» (`ManagerScreen` с `embedded`). Граница проходит в
ДВУХ местах сразу, и оба обязательны: политики базы (миграция 0031 —
разделы читают все, меняет владелец; участников ставят только в свои
задачи) и интерфейс, который не показывает того, в чём откажут. Второе не
для красоты: отказ RLS МОЛЧАЛИВ — строка исчезает из списка до
перезагрузки и возвращается после неё, а человек уверен, что что-то сделал.
Поэтому у чужой задачи, встречи и мысли нет ни срока, ни состава, ни
приёмки, ни «Удалить» — только чтение и обсуждение. «Своё» = `created_by`
равен моему auth-id; у владельца он пуст, и это значит «всё моё».
Синхронизация штампует чужое пространство сама (`user_id` владельца плюс
`created_by` мой) и фильтрует по автору — что бы ни пометило чужую строку
изменившейся, до базы это не доедет.

**Постановщику — сводка, исполнителю — сразу.** Кирилл прислал снимок своей
переписки с ботом: шесть сообщений подряд, каждое про своё. «Если таким
сплошняком инфа будет переть, я офигею это всё читать и элементарно не
смогу нормально воспринимать». Поэтому всё, что адресовано ПОСТАНОВЩИКУ,
копится в `notification_queue` (миграция 0030) и выходит одним письмом из
крона: группы по смыслу, сверху то, что требует решения. Событие кладётся
тремя полями — что за задача, кто, какими словами, — а заголовок группы
пишется при отправке: склеенную заранее строку пришлось бы разбирать
обратно, чтобы сложить с соседней. Всё, что адресовано ИСПОЛНИТЕЛЮ, уходит
мгновенно: там ждут ответа от него, и задержка стоит дороже порядка.
Добавляя уведомление, решите, к какой половине оно относится, и передайте
`notice` в `notifyAuthor` — без него оно уйдёт отдельным сообщением в ленту.

**Заведённая задача — не черновик.** У неё нет полей: название заголовком,
описание текстом, из правки только срок (его двигает постановщик), состав,
приёмка и обсуждение. Причина та же, что у назначенной встречи: задачу уже
отправили человеку, он её принял и по ней отчитывается, а правка названия
или приоритета в этот момент разводит то, что записано, и то, что он видел.
Полная форма — только у новой задачи. Приёмка закрывает окно: задача уходит
в «Завершённые», и окно, висящее над закрытой задачей, — это вопрос «а что,
не сработало?». Возврат на доработку закрывает его тоже.

**Кнопка в мессенджере — там, где от человека ждут ответа.** Правило шире
одного места: каждое сообщение бота, после которого чего-то ждут, обязано
нести кнопку этого действия. Кнопка жила только под тем сообщением, которым
задачу прислали, — переписка уезжала вверх, и отвечать было нечем. Теперь у
коллеги есть свои команды и списки кнопками (`colleagueQueries`), «Ответить»
адресует следующее сообщение конкретной задаче (миграция 0028, живёт два
часа), а переписанное сообщение обязано нести кнопки следующего шага — в
MAX это тем более важно, там нет всплывающих подсказок и переписанное
сообщение и есть весь ответ.

**Порог телефона — 1000px, и он записан в двух местах.** `MOBILE_QUERY` в
`useIsMobile` и медиазапрос мобильного блока в `tracker.css` обязаны
совпадать: разметка оболочки и её стили включаются вместе. Было 768 против
1150 у колонок — и между ними лежала полоса без вкладок и без колонок, одна
длинная лента, где до встреч надо пролистать все задачи.

**Своё или чужое — один ответ на весь трекер** (`lib/ownership.ts`). «Я»
передаётся ПУСТЫМ для владельца, и пустое означает «всё моё»: у всего, что
он завёл, `created_by` пуст — колонка появилась вместе с
многопользовательской частью и его собственные строки не помечает. Строгое
сравнение с его настоящим id однажды объявило чужой всю его работу, и он на
полчаса перестал мочь закрыть собственную задачу. Правило было написано в
четырёх местах чуть по-разному — и сломалось именно поэтому.

**У руководителя свободный текст в боте — это поручение, а не реплика.**
У коллеги без входа в трекер наоборот: его слова идут в обсуждение
угаданной задачи, как и шли. Развести это пришлось, когда фраза «поручи
Игорю смету» от руководителя молча легла репликой в чужую карточку. Чтобы
написать в обсуждение, руководитель нажимает «💬 Ответить» — тот же
механизм адресации, что и у всех. Ничего при этом не создаётся молча:
разобранная фраза показывается и ждёт «да» (`pending_action` на строке
человека, миграция 0033).

**Повтор по дням недели читается из массива, а если он пуст — из старой
колонки.** `recurDays()` в `taskDisplay` и та же пара строк в `taskLogic`
(миграция 0032). Переносить прежние задачи незачем: правило короче любого
переноса и не может ошибиться на данных, которых ещё не видело. «Последний
срок» у задачи на нескольких днях считается по БЛИЖАЙШЕМУ дню назад, а не
по первому в списке, — иначе закрытая в четверг задача откроется снова.

**Предложенная встреча времени не занимает.** Четвёртое состояние `status`
(миграция 0034): встреча существует, стоит в списке, по ней отвечают «буду»
— но календарь и напоминания спрашивают ровно `planned` и её не видят.
Назначить может владелец, одной кнопкой в карточке. Встреча, созданная
руководителем, начинается предложением: назначить значит занять чужое
время, и такого права у него нет.

**Просроченное подаёт голос ступенями** (`lib/escalation.ts`): три дня —
человеку с кнопками, семь — постановщику, четырнадцать — обоим и последний
раз. Ступень срабатывает РОВНО на ступени и один раз за жизнь задачи:
«больше либо равно» означало бы, что задача, просроченная на месяц, каждый
день сообщает о тройке. Отказ считается ответом — человеку, сказавшему «не
могу», о сроке не напоминают.

**Перенос срока — событие, а не тихая правка.** Сам срок двигает движок
синхронизации (колонка его), а `/api/workspace/review` с `action:
"deadline"` пишет строку в хронику и говорит исполнителям. До этого старая
дата просто исчезала, и человек планировал неделю под прежнее число.

**Две сессии работают в ОДНОЙ рабочей копии.** Кирилл открывает несколько
чатов сразу, и это не две ветки и не два клона: один каталог, один
`git status`, одно дерево на всех. 18.09.2026 две сессии правили его
одновременно, и разошлось всё, что могло: одна вклинила свой `useEffect`
внутрь чужого комментария, разорвав фразу пополам; вторая не могла
закоммитить свой файл, потому что он уже импортировал функцию из чужого
незакоммиченного; и обе ждали друг друга, пока Кирилл ждал результата.
Правило из этого — четыре строки, и оно не про вежливость, а про то, чтобы
в `main` не уехала половина чужой работы:

- **Объявите файлы, прежде чем их трогать.** Перед первой правкой —
  сообщение другой сессии: какие файлы беру и зачем. Список чужих файлов —
  граница; в них не лезут, о них просят.
- **Коммитьте СВОИ файлы, а не `git add -A`.** Общее дерево означает, что
  «всё» — это и чужое недоделанное. Перечисляйте пути руками. Это правило
  я нарушил 19.09.2026 и получил ровно то, от чего оно защищает: в коммит
  уехал чужой компонент, а хук, из которого он берёт данные, остался
  несохранённым. Дерево собиралось, потому что файл лежал рядом на диске;
  в `main` его не было, и сборка упала бы там. **Зелёное дерево не значит
  зелёный коммит** — проверять надо то, что уходит, а не то, что лежит.
- **Общий файл коммитит тот, кто уходит из него последним**, и говорит об
  этом вслух. Если ваш файл импортирует то, чего в `main` ещё нет, — вы
  коммитите вторым, иначе сборка на Vercel падает на чужом отсутствующем
  экспорте.
- **Проверки — на всём дереве перед КАЖДЫМ коммитом**, а не на своих
  файлах: зелёными должны быть вы вместе, потому что уедете вы тоже
  вместе.

Чужую правку не откатывают молча: если она выглядит ошибкой — пишут той
сессии. Правка, отменённая без разговора, возвращается через десять минут,
и так до бесконечности.

**Windows/Git Bash:** heredocs eat backslashes, so a patch script written
with `cat <<'EOF'` mangles `\n` and regexes — use the Write/Edit tools for
anything containing a backslash. `next build` fails on `.next` files locked
by a running `next start` (and by OneDrive) — stop the server first.

## Open threads

- **Разбор 18.09.2026 и что из него сделано.** `docs/improvements.md` —
  разбор по четырём вопросам Кирилла (работа подчинённых, рабочее
  пространство, кнопки в мессенджерах, единый интерфейс с правами) с
  отметками «СДЕЛАНО» там, где это так. `docs/next-ten.md` — следующие
  десять улучшений и, что важнее, три вещи, которые НЕ стоит делать, хотя
  их просят: личные пространства руководителей, настройки уведомлений на
  человека, вложенные задачи. Прочитайте оба, прежде чем предлагать
  что-нибудь из этого заново.

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
