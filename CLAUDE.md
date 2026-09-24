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

## What this tracker is for

Said outright 23.09.2026, as the reason the whole project exists: Кирилл
once assigned ten people different tasks and later remembered only two of
them — and colleagues learned to count on exactly that forgetting. The
tracker's job is to be an external memory nobody can outwait: whatever a
person commits to, for themselves or someone else, stays visible until it
is actually resolved. Planning and follow-through are the focus, not a
history of what is already done — a closed item should get out of the way,
not accumulate as archive to maintain.

**Equal footing, one exception.** Every participant can assign tasks and
meetings to themselves and to colleagues on the same terms — this is
literally why the tracker was first built (his own recurring need to
assign himself work, not just others). The one boundary that never moves:
`isOwner` (Команда, access, roles) stays with Кирилл alone; everything
else about *doing* work is symmetric, postановщик and исполнитель included.

**Visibility is per-person, no exceptions — himself included. DONE
23.09.2026.** A participant sees an item only if they are its
postановщик, executor, co-executor, observer, or an invited/organizing
meeting participant. Everything else stays off their screen entirely, not
read-only-visible — "чтобы не засорялся эфир". This reversed the earlier
"Трекер один на всех: чужое видно для чтения" design. `NewTracker.tsx`
computes `visibleTasks`/`visibleMeetings` once (`lib/itemVisibility.ts`)
and hands them to every panel instead of the raw arrays — see
`docs/how-it-works.md` («Видимость») and `docs/next-ten.md` (п. 11) for
what actually changed and a real bug the unit tests caught along the way
(`isMine()` is the wrong check for "do I see this" — it answers "can I
edit this," and always says yes for the owner).

Full detail lives in `docs/how-it-works.md` — read it before touching
anything about what a screen shows to whom; if code and that document
disagree, the document is right and the code needs fixing.

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
                      # доступ (ссылка на новый пароль и «забыли пароль»),
                      # владелец как ПОЛУЧАТЕЛЬ работы (задача от
                      # руководителя, приёмка, встреча с ним, реплика,
                      # доходящая до постановщика), переименование
                      # человека сразу во всех трёх местах. 123 проверки.
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
**И третий, самый обманчивый: прогон, запущенный сразу после `git push`.**
Он бегает по ЕЩЁ НЕ СОБРАННОЙ сборке, то есть по прежнему коду, и врёт в
обе стороны: красный там, где всё исправлено, и зелёный там, где правку
уже сломали. 23.09.2026 это стоило двух ложных диагнозов в двух сессиях
подряд — обе решили, что деплой упал, хотя он просто ещё шёл. Прежде чем
объяснять падение кодом, прогоните второй раз; если сомневаетесь, проверьте
на боевом что-нибудь БЕЗУСЛОВНО новое из этого же пуша (подпись кнопки,
класс) — это одна проверка вместо получаса поисков.
**Четвёртый флейк оказался настоящей потерей данных, а не средой —
пойман 23.09.2026 на «вычеркнутые мысли идут свежими сверху», починен
там же.** Первая догадка — гонка догона (`lib/revive.ts`) с двумя
быстрыми действиями подряд — была верной по симптому и неполной по
причине (82d1a2a развёл снимок «shadow до запроса / live после ответа»,
падений стало меньше, но не ноль). Настоящий корень — глубже и опаснее
самого догона: тень (запись «что подтвердила база») пересобиралась из
ЭКРАНА после ответа сети, а отправлялось то, что было ДО — набранное за
эту секунду попадало в тень как подтверждённое, не будучи отправленным
вовсе, и трекер при этом честно писал «✓ Сохранено». Строка жила только
на экране и пропадала при следующем перечитывании (сравнение видело
несовпадение с базой и стирало её как «удалённую на другом устройстве»).
Без догона это была бы редкая, тихая потеря после перезагрузки; догон
просто делал её быстрой и заметной. Починено в 59e7faa: обе половины
снимка берутся из ОДНОГО среза до сети, а на расхождение отвечают
возвратом строки из тени, а не жёстким удалением. Десять прогонов
теста подряд на 59e7faa — зелёные.
Третьего не осталось: прогон идёт в ОДИН воркер (`playwright.config.ts`),
потому что тестовый аккаунт на весь прогон один и параллельные тесты
топтали строки друг друга. Пока не появится аккаунт на воркера,
`workers: 1` — это не настройка скорости, а условие осмысленности: тест,
падающий в общем прогоне и проходящий в одиночку, читается как регрессия и
съедает час на её поиски.

**Перетаскивание в e2e: сначала дождитесь, пока цель перестанет ездить.**
Три теста подряд (разделы, карточка внутри столбца, мысль на день) падали
в общем прогоне и проходили в одиночку, и каждый раз причина была одна и
та же, а вовсе не dnd: между `boundingBox()` и `mouse.down()` страница
живёт — приезжают задачи соседних тестов, растут столбцы, появляется
полоса «Загрузка», — и нажатие приходится мимо. Перенос не начинается
вовсе, а отказ звучит как «порядок не изменился»: правда, но не та.
Отсюда `settled()` в `e2e/helpers.ts` (два одинаковых замера подряд) и
проверка, что перенос ДЕЙСТВИТЕЛЬНО начался (класс `.dragging` у разделов,
`.dnd-card-ghost` у карточек), — без неё промах объявляется в самом конце.
Playwright ждёт стабильности сам, но только внутри своих действий; между
двумя нашими вызовами эта гарантия не живёт.
*А вот траекторию не трогайте без замера.* Перестановка карточек внутри
столбца устроена так, что смещается не курсор, а карточка, и «вести её
шагами, перемеряя цель» — попытка, которая кажется очевидной и делает
хуже: 21.09.2026 такая правка дала 0 из 3 прогонов против 2 из 3 у
прежней. Этот тест остаётся хрупким, и это известно; прежде чем «чинить»
его в третий раз, прогоните обе версии по три раза и сравните.

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

**И тень описывает ТО, ЧТО ОТПРАВИЛИ, а не то, что на экране сейчас.** Это
продолжение того же правила, и оно стоило пропавших записей — молча, годами.
Строки для отправки читались из `liveRef` ДО запроса, а тень в конце блока
пересобиралась из `liveRef` ПОСЛЕ ответа сети. Всё, что человек успевал
записать за эту секунду, попадало в тень как подтверждённое, НЕ БУДУЧИ
ОТПРАВЛЕННЫМ, и следующий дифф разницы уже не видел: тень про строку «знает».
Мысль оставалась на экране, трекер писал «✓ Сохранено», а в базе её не было
вовсе — и она исчезала при первой же перезагрузке. Поймано на боевом
23.09.2026 циклом «записать две мысли → дождаться „Сохранено“ → пауза →
вычеркнуть первую» с растущей паузой: на круге, попавшем в тик перечитывания,
второй мысли не было в базе СРАЗУ после подтверждения сохранения. Теперь
снимок берётся один раз, до сети, и он же идёт в тень.
Три вывода на будущее, и все три шире одного файла.
*Догон не создавал эту потерю, он её ОБНАЖИЛ.* Перечитывание не находило
строку в базе, тень утверждала, что она подтверждена, — и слияние могло
прочесть это только как «удалили на другом устройстве». Строка исчезала с
экрана через минуту вместо того, чтобы исчезнуть при следующем входе. Ошибка
та же, просто ставшая видимой; чинить надо было её, а не того, кто показал.
*Строка, пропавшая из live, — расхождение, а не приказ удалить.* На это
место приходился жёсткий `DELETE` навсегда. Ничего законного сюда не
приходит: удаление задачи, встречи или мысли чистит ОБА списка и шлёт мягкое
удаление, realtime и догон правят оба. Теперь строка возвращается на экран из
тени. Тот же урок уже был оплачен ниже, в ветке `assignees`: тем же `DELETE`
когда-то был потерян человек со всем его участием.
*«Сохранено» — это обещание, и его нужно проверять по базе, а не по экрану.*
Ни один тест не мог поймать это чтением кода: изнутри отправленное и
неотправленное выглядят одинаково. Поймал ЗАПРОС К БАЗЕ сразу после
подтверждения — им и проверяйте всё, что называется сохранением.

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
на установщик, которую можно давать людям.
**Приложение называется «Планировщик задач»** — с версии 1.0.2 и по его
слову 20.09.2026 («название приложения лучше такое — „Планировщик
задач“»). Так уже назывались заголовок окна и установленное PWA
(`layout.tsx`, `manifest.json`), а установщик, папка и ярлык звались
«ROKAS Tracker» — то есть одна и та же вещь имела два имени. Имя файла
установщика при этом остаётся латиницей (`Planirovshchik-Zadach-Setup-*`):
кириллица в адресе ссылки на GitHub превращается в проценты, а ссылку
дают людям. `appId` (`ru.rokas.tracker`) НЕ меняется никогда — по нему
установленное приложение узнаёт себя и свои обновления, и смена имени
проходит как обычное обновление, а не как второе приложение рядом.
Две вещи из первого выпуска, которые повторятся у следующего:
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
*Один релиз на тег, и это пришлось выбить.* У 1.0.1–1.0.3 на каждый тег
создавалось ДВА релиза: electron-builder грузит установщик и его
`.blockmap` (файл для докачки по частям) двумя обращениями, оба не
находят готового релиза и оба его создают. Опаснее всего то, как это
выглядит: сборка зелёная, установщик есть — но «последним» GitHub
показывает тот релиз, в котором лежит один `.blockmap`, без `.exe` и без
`latest.yml`. То есть человек по ссылке «последний релиз» скачать ничего
не может, а установленное приложение не находит обновления и молчит.
Лечится тем, что релиз публикует отдельный шаг workflow (`gh release
create` со всеми файлами сразу), а electron-builder только собирает
(`--publish never`).
*А отключать blockmap НЕЛЬЗЯ*, хотя это выглядит очевидным решением и
было им полдня: вместе с `differentialPackage: false` из `latest.yml`
пропадает `size`, и electron-updater такой фид не принимает вовсе —
обновление перестаёт находиться совсем, и опять молча. Так сгорела
1.0.4: релиз один, файлы на месте, а обновления нет.
Проверять выпуск надо не по зелёной галочке, а по списку файлов (это
теперь делает сам workflow, но при ручной проверке):
`curl -s https://api.github.com/repos/Kirill900504/task-tracker/releases/latest`
должен показать и `.exe`, и `latest.yml`.
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

**Окна — настоящие `<dialog>`, меню — верхний слой.** Своими `div`-ами
окно приходится доделывать вручную: Esc, клик мимо, фокус, который не
должен уходить за него, возврат фокуса, недоступность фона для клавиатуры.
Половины этого просто не было. `showModal()` даёт всё сразу, и заодно
верхний слой, который не обрезать чужим `overflow` и не перекрыть чужим
`z-index`. Но у него есть цена, и её надо знать: модальное окно делает
inert ВСЁ, что не лежит внутри него, — меню, портированное в `<body>`,
остаётся видимым и перестаёт принимать нажатия. Выглядит это как «кнопка
не работает». Поэтому `PopLayer` (popover-слой для меню и подсказок)
монтируется ВНУТРЬ открытого окна, если оно есть: inert считается по
дереву документа, а не по слоям.

**Что приходит снаружи — проверяется схемой** (`lib/apiInput.ts`, zod).
Маршруты проверяли тела сами, каждый по-своему, и проверяли наличие, а не
смысл: дата могла быть словом «завтра». Схема описывает и проверяет
одновременно, а отказ называет поле — «Неполный запрос» не говорил ничего.
Почта проверяется СВОИМ правилом, а не `z.string().email()`: встроенное
требует ASCII до собаки и отвергает `нет-такой@example.invalid`, на чём
сразу упали две проверки в `test:workspace`.
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

**ПОСТАНОВЩИК в боте — это любой, кто поставил задачу.** 20.09.2026:
«надо чтоб каждый человек мог принять работу из мессенджера и делать
любые манипуляции, так как сейчас мы делаем абсолютно равноправный для
всех постановщик задач». До этого половина постановщика (принять,
вернуть, продлить, напомнить, открыть заново, поручить, списки, меню)
искала чат в таблице аккаунтов — а он там только у владельца, — и
руководитель шёл принимать собственную задачу в трекер.
Теперь чат превращается в АКТОРА (`lib/botActor`): кто нажал, в чьём
пространстве, видит ли он в нём всё. Права считаются так же, как в
маршрутах трекера, — по `created_by`, — и делает это ОДНО место:
`actorScope()` в выборке. Отдельных проверок «а ваша ли это задача» нет
нарочно: чужая задача просто не находится, и все ветки отказывают
одинаково. Забытая проверка в одной ветке означала бы чужую закрытую
задачу.
Что из этого следует:
*Незакрытые вопросы общие.* Причина возврата, итог встречи, шаг мастера
приходят следующим сообщением, и разбирает их одна функция
(`assignerPending` в `botPipeline`) для обоих чатов. Помнится вопрос там,
где живёт чат: у владельца в таблице аккаунтов, у остальных на строке
человека (`pending_action`, миграция 0033). Раньше это был разбор только
в ветке владельца, и текст руководителя уходил в половину получателя,
где такую память никто не ждал.
*Кнопки под сводкой снова одни на всех* — они наконец работают у каждого,
кому сводка адресована.
*Границы остались там же, где были.* Назначить встречу по-прежнему может
только владелец (предложить — любой): назначить значит занять чужое
время. «Команда», приглашения и журнал поломок — тоже владельцу. Всё
остальное у постановщиков одинаково.

**`.match()` выбрасывает `undefined`, и поэтому фильтр может исчезнуть
молча.** 20.09.2026, в тот же день, когда появился актор: в одну ветку
вместо `BotActor` приехала голая строка с id. Тип не поймал — Supabase
без сгенерированных типов отдаёт поля как `any`, и строка проехала туда,
где ждут объект. Дальше `actorScope` прочитал у строки несуществующий
`spaceId`, положил `undefined` в обе колонки, а PostgREST ключи со
значением `undefined` ПРОСТО УБИРАЕТ. Запрос ушёл без единого условия:
на «что сегодня» бот ответил девятнадцатью задачами вместо восьми —
чужими пространствами целиком. Кнопки не болели, болел только текст
команды: актора там собирали не в том месте.
Три вывода, и все три уже в коде.
*Ошибка границы несимметрична.* Лишний фильтр — пустой список, и о нём
скажут через минуту. Пропущенный — чужие данные на экране, и не скажет
никто: выглядит как данные.
*Фильтр, который не может отфильтровать, не строится вовсе.*
`actorScope` теперь бросает, если актора нет или он неполон. Падение
бота — это строка в журнале и одно неотвеченное нажатие; исчезнувший
фильтр — утечка.
*Тест воспроизводит причину, а не симптом* (`botActor.test.ts`): в него
передают строку вместо актора — ровно так, как это случилось.

**У ВЛАДЕЛЬЦА в боте свой набор кнопок, и разбирается он отдельно.** Его
чат живёт в `telegram_accounts`/`max_accounts`, а не в строке человека, —
поэтому до 20.09.2026 любое его нажатие отвечало «этот чат не подключён».
Теперь нажатие разбирает `lib/botCallback` (один разбор на оба
мессенджера, как `botPipeline` для текста): сначала пробуется коллега,
потом владелец, и кто-то отвечает всегда — кнопка без ответа читается как
сломанная. Его половина живёт в `ownerQueries.ts` (что показать),
`ownerReplies.ts` (что делает нажатие) и `ownerNewTask.ts` (мастер
«Поручить»): меню, списки кнопками, карточка задачи ПОСТАНОВЩИКА
(принять, вернуть, продлить, напомнить), встреча с итогом, мысли.
Правила, стоящие за приёмкой и итогом, вынесены в `reviewWork.ts` и
`meetingRecap.ts` — их зовут и маршруты трекера, и бот; писать их второй
раз нельзя (в этом проекте вторая копия расходилась с первой трижды).
Незакрытые вопросы бота — возврат с причиной, шаг мастера, итог встречи —
лежат в одной колонке `pending_action`, различаются полем `kind` и всегда
старше любого другого разбора текста.

**Кнопка живёт в том чате, который её разбирает.** Это не мелочь и не
теория: владельческие `t:olist` / `t:omenu` / `t:new` разбираются ТОЛЬКО
по строке в таблице аккаунтов, и та же кнопка, попавшая в чат
руководителя, молчит — а молчащая кнопка неотличима от сломанной.
Поэтому сводка из очереди уходит с разными наборами (`briefButtons` для
владельца, `navButtons` для руководителя), и прежде чем вешать кнопку
под сообщением, отвечайте, чей это чат. Обратная сторона того же: сам
владелец бывает исполнителем — задача, поставленная ему руководителем,
приходит с кнопками получателя, поэтому нераспознанное нажатие в его
чате сначала пробуется как «коллежское» и только потом объявляется
чужим (`botCallback`). Диагностика 20.09.2026 нашла оба конца этой
ошибки: «💬 Ответить» в его карточках не делала НИЧЕГО с самого начала,
то есть написать в обсуждение из мессенджера постановщик не мог вовсе,
а его свободный текст — поручение, и другой двери нет.

**Меню в боте — одно, и разделы объявлены ОДИН раз** (`lib/botMenu.ts`).
Прямое следствие правила выше, и оно чуть не стало третьей копией
одного смысла. Меню было только у постановщика — девять кнопок; у
получателя их было ДВЕ, при том что «сегодня», «просрочено» и «на
приёмке» у него давно работали и ждали, чтобы их угадали словом. Раздел,
к которому нет кнопки, для человека не существует. Очевидный способ это
починить — написать второе меню рядом с первым — здесь неверен: в этом
проекте вторая копия расходилась с первой трижды. Поэтому строка таблицы
`SECTIONS` несёт ОБЕ свои кнопки сразу, `olist` и `list`, и забыть
половину нельзя. Разные `data` у одного раздела — это и есть правило про
чат, применённое к меню; `ownerMenu`/`ownerNav`/`navButtons` остались
именами и зовут одну функцию.
Что из этого следует, когда добавляете раздел: сперва ответьте, есть ли
он у получателя ВООБЩЕ. У мыслей, например, нет и не может быть — строки
`ideas` держатся за `created_by`, а у получателя без входа нет auth-id.
Кнопка, ведущая к отказу, хуже отсутствующей.

**Меню в боте многоуровневое: следующий уровень занимает место прежнего.**
22.09.2026, его словами: «чтобы при нажатии кнопок не выдавало новым
сообщением следующие стадии, а выдавало следующие уровни выборов, а только
потом запрашиваемый результат (чтоб не засорять историю чата бота)». До
этого каждое нажатие оставляло в чате новое сообщение: меню, под ним
список, под ним карточка — три сообщения, из которых живо последнее, и так
на каждый заход. Переписывать сообщение бот умел с самого начала
(`rewriteTo`), но только в ответ на ДЕЙСТВИЕ — приёмку, продление срока;
навигация всегда шла отдельным сообщением.
Правило теперь одно и живёт в одном месте (`asScreen` в `lib/botCallback`):
нажали ВНУТРИ экрана — ответ переписывает нажатое сообщение; нажали под
присланной задачей или под утренней сводкой — открывается новым, потому
что переписать чужой текст нельзя, за ним человек сюда и пришёл.
Отличить одно от другого можно только по самой кнопке: «☰ Меню» стоит и
там и там. Поэтому экран помечает свои кнопки знаком в `callback_data`
(`screenButtons`, знак `~` перед действием), и нажатие приходит обратно
со знаком; `decodeCallback` его снимает, так что действие остаётся тем же.
Ни таблицы, ни лишнего запроса это не стоит — а память «какое сообщение
было экраном», лежащая в базе, разъехалась бы с чатом при первом же
повторе.
Что здесь легко сломать: кнопки НОВОГО уровня обязаны быть помечены тоже
(это делает тот же `asScreen`), иначе экран переписывается ровно один раз,
а дальше снова растёт лентой. И наоборот: помеченная кнопка под
сообщением, которое экраном не является, сотрёт его — поэтому у
присланной задачи кнопки остаются обычными, хотя «Принял» тоже
переписывает её текст. Сторожа два: `botCallback.test.ts` на само правило
и две проверки в `test:bots`, где та же кнопка нажимается со знаком и
обязана сделать ровно то же самое.

**Бот отвечал медленно, потому что функция жила за океаном от базы.**
Его слова 22.09.2026: «очень медленная реакция бота на нажатие кнопок в
меню». Причина была не в коде: `X-Vercel-Id` отвечал `fra1::iad1` — запрос
приходил во Франкфурт, а исполнялся в Вашингтоне, при базе в
`eu-central-1`. Каждый вопрос к базе летал через Атлантику и обратно, а на
одно нажатие их три-пять, и к ним ещё два вызова в Telegram. Лечится одной
строкой — `"regions": ["fra1"]` в `vercel.json`, — и это первое, что стоит
проверить, когда «стало медленно»: регион функции не виден ниоткуда, кроме
этого заголовка, и ставится он по умолчанию, то есть никем.
Остальное оттуда же, и каждое проверяется тем же способом — «сколько
полётов туда и обратно»: вопросы, не зависящие друг от друга, задаются
РАЗОМ (`findActorByChat` спрашивает обе таблицы сразу, «сегодня» берёт
задачи и встречи одним заходом); `botPipeline` подгружается только для
ТЕКСТА (за ним GigaChat и половина ассистента — холодный контейнер
разбирал весь этот граф перед тем, как ответить на нажатие); а в MAX
нажатие больше не предваряется сообщением «Открываю» — всплывашек там нет,
и toast уходил отдельной строкой в чат перед самим ответом.

**Мини-приложение: подпись мессенджера — это пароль.**
`/app` меняет подпись Telegram или MAX на сессию Supabase
(`lib/miniAppAuth.ts`, проверка в `lib/telegramInitData.ts`), и одна
функция обслуживает оба: MAX описывает ТОТ ЖЕ алгоритм, вплоть до строки
«WebAppData». Сделано 20.09.2026, потому что пароль от трекера — та самая
преграда, из-за которой человек вне офиса не открывает его вовсе.
Три вещи здесь не косметические. *Проверка тестируется подделками*, а не
честными данными: подменённый id внутри честно подписанной строки, чужой
токен, вчерашняя подпись; ошибка тут равна отданному паролю. *Поля не
перечисляются руками* — в подпись входит всё пришедшее, кроме `hash`,
иначе следующее поле, добавленное Telegram, сломает вход.
*Сравнение постоянного времени* обязательно: по времени ответа подпись
подбирается побайтно.

**И главный урок того же дня: подпись нельзя проверять своими же
подписями.** Вход не работал НИ У КОГО, и отвечал он «Подпись не
сходится». Причина — одно исключённое поле: `signature` не входит в
подпись у ТРЕТЬЕЙ проверки (Ed25519, для тех, кому нельзя давать токен
бота, — «except hash and signature»), а в нашей, по `hash`, оно
обычное поле, как все («all received fields»). Две проверки Telegram
описывает рядом, и перепутать их — дело одной строки.
Не поймало это ничто: одиннадцать тестов, включая четыре на подделки,
подписывали вход ТЕМ ЖЕ кодом, который его проверял, — и сходилось не
с Telegram, а с собственной ошибкой. Настоящие данные, где `signature`
есть всегда, оказались единственным непроверенным случаем.
Отсюда два правила на будущее. *Проверка подписи, испытанная только
своей подписью, не испытана.* Если чужую подпись воспроизвести нельзя —
это и есть причина, по которой отказ обязан говорить БОЛЬШЕ, чем «не
сходится»: теперь он возвращает ИМЕНА пришедших полей (не значения —
там имя, фото и идентификаторы), и страница печатает их мелко внизу.
Один снимок экрана вместо дня догадок. *И расчёт оставлен
двухвариантным* — со `signature` и без: обе строки требуют токена бота,
то есть замок не слабее ни на бит, а ошибка в эту сторону стоит ещё
одного дня, когда войти не может никто.
И граница: сессию получает только тот, у кого вход УЖЕ есть. Остальным —
слова о том, что бот работает прямо в чате, а не пустой экран. Поэтому
же кнопка у поля ввода ставится ПОИМЁННО (`syncTelegramAppButtons`, крон
раз в сутки): трекер тем, кто может войти, список команд всем остальным.
В MAX ссылки мини-приложения пока нет — её установка отправляет бота на
модерацию заново (решение Кирилла, см. ниже), и там кнопка работает
обычной ссылкой во внешний браузер. Поэтому `/app`, открытая без данных
мессенджера, не объясняется, а уводит: в трекер при живой сессии, на
форму входа без неё.

**Решение подписывается именем, а не должностью** (`lib/actorName.ts`).
В хронику писалось «Владелец принял работу» и «Постановщик вернул на
доработку», а реплика руководителя приходила людям подписанной словом
«Коллега». При четырнадцати постановщиках это отвечает на всё, кроме
единственного вопроса, который к такой строке задают, — кто. Имя берётся
по строке членства (так же, как это делает трекер в `useAuthors`), и
пометка «(я)» с него снимается: она написана для одного человека, а
читают её все. Слова Кирилла 20.09.2026 о позиционировании: участники
равноправны, роль у них по задаче — «постановщик» и «получатель», — а не
по месту в системе. Слово «коллега» из того, что видит человек, ушло:
в запасе стоит «Участник». Полное имя строки (с «(я)») по-прежнему
пишется в `tasks.assignee` — там оно должно совпадать буква в букву.

**Куда писать человеку — спрашивают у `lib/reach`, а не у его строки.**
У всех, кроме владельца, чат лежит прямо в строке `assignees`, и
`chatsFor` берёт его оттуда. У владельца такой строки с чатом нет и не
будет: он подключает мессенджер к УЧЁТНОЙ ЗАПИСИ, и чат живёт в
`telegram_accounts`/`max_accounts`; строка «Кирилл (я)» стоит в списке
людей ради имени в поле «Исполнитель», и чат у неё пустой. Пока поручал
только он, это было неважно — он был отправителем. С паритетом
постановщиков (20.09.2026) он стал адресатом, и ДЕСЯТЬ рассылок,
написанных через `chatsFor`, замолчали разом: задача от руководителя,
возврат на доработку, приёмка, перенос срока, ответ на просьбу, ступени
просрочки, утренняя сводка «что от вас ждут», подтверждение встречи,
итог встречи, «Поторопить». Молчали тихо: строка участия есть, кнопки
работают, отказа нет, сообщение не уходит никуда. Оттуда же и
«Забыли пароль?», которое у него не работало вовсе, — ссылку выдать ему
некому, он и есть тот, кто выдаёт её другим.
Граница «себе не пишут» осталась, но считается ОТ ТОГО, КТО ПОРУЧАЕТ, а
не от метки: в браузере это `lib/me` (владелец — чей id совпадает с
пространством), на сервере — параметр `createdBy`, а `/api/telegram/send`
отвечает полем `self`, чтобы «себе» не читалось как «не подключён».
Общее правило шире: **прежде чем написать фильтр «кроме себя», ответьте,
кто здесь „я“.** Тем же допущением («я» — это всегда Кирилл) была
вырезана из списка приглашаемых его строка, и встреча руководителя с ним
не могла существовать вовсе. Разбор целиком — `docs/interactions.md`.

Под самим сообщением не написано ничего. Всё, что с ним можно сделать —
реакции, «Изменить», «Убрать», «Копировать текст», — живёт в меню по правой
кнопке (`ChatMessageMenu.tsx`), на телефоне оно же по долгому нажатию (450 мс,
движение пальцем отменяет — иначе меню открывается при каждой прокрутке).
Так просил Кирилл, «по аналогии с телеграм», и он прав: строка «☺ изменить
убрать» под каждой репликой — это ветка, которую читаешь через подписи к ней.
Реакции, которые уже стоят, остаются видимыми под сообщением; пустая строка
не рисуется вовсе. Набор эмодзи фиксирован (`REACTIONS`) по прежней причине —
реакция уезжает в мессенджер строкой под сообщением.

**Постановщик — не участник, и каждая политика «по участию» обязана
знать об авторе.** 24.09.2026 Станислав не видел переписку по задаче,
которую сам поручил Игорю, и не мог в неё написать: `item_comments_visible`
пускала только `is_participant`, а автор (`created_by`) в строках участия
не стоит. Отказ на ЗАПИСИ был тем же отказом на чтении: клиент просит
строку обратно (`.insert().select()`), и вернуть можно только то, что
можно прочесть. Владельца это не касается никогда (его строки —
`user_id = auth.uid()`), поэтому такая дыра живёт у всех, кроме того, кто
проверяет первым. Миграция 0041; в `test:schema` — случай «автор читает и
пишет, посторонний нет». Добавляя политику по участию, добавьте автора
через `task_author`/`meeting_author`/`idea_author`.

**Жест на телефоне — касаниями, а не pointer-событиями.** Листание
разделов не работало ни разу на настоящем телефоне при зелёном e2e: как
только палец поехал, браузер забирает касание под прокрутку и шлёт
`pointercancel` вместо `pointerup`. Синтетическое событие в тесте до
прокрутки не доходит, поэтому тест и не мог этого поймать. `MobileShell`
слушает `touchstart/touchend` (их прокрутка не отменяет), а у элемента со
своим pointer-жестом должен стоять `touch-action` (`.swipe-wrap` —
`pan-y`). Если «свайп не работает», первым делом спросите, какие события
он слушает.

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

**«Загрузка» — окно под кнопкой, а не панель, и фильтра по исполнителю
больше нет.** 20.09.2026: «фильтр по исполнителю получается не нужен,
если добавил блок загрузка… а оттуда этот блок убери, он мешает». Это
был один вопрос, заданный дважды: выпадающий список из четырнадцати имён
без единой цифры и список тех же людей с цифрами над мыслями. Осталось
второе (`LoadModal`), кнопка «Загрузка» стоит в полосе над доской и
показывает, у скольких людей есть о чём говорить; выбор человека сужает
доску и закрывает окно, снимается фильтр крестиком в той же пилюле.
Кнопки нет вовсе, пока никому ничего не поручено. Порядок полосы задан
им же: «Загрузка», «Все / Мне / Я поручил» (именно в таком порядке),
«Просрочено», «Завершённые». Заголовки столбцов — по центру.

**Окно без `<div className="modal">` разваливается по экрану.** `Modal`
даёт только `<dialog class="overlay">` — затемнённый фон с `display:flex`;
фон коробки, рамка, ширина и отступы живут на вложенном `.modal`. Без него
заголовок, строки и кнопки становятся flex-элементами затемнения и
расползаются по углам. Так уже жили «Завершённые» и «Разделы» — с виду
исправный код, потому что класс на `<dialog>` выглядит как стиль окна.
Починены 20.09.2026 вместе с «Загрузкой»; новое окно собирайте по образцу
`TaskModal`/`LoadModal`.

**У всех окон одна форма, и она не во весь экран.** Слова Кирилла
20.09.2026 — «окна не должны быть растянуты от потолка до пола, они
должны быть более-менее стандартизированной однотипной формы», и это про
все окна второго и третьего уровня. Потолок задан один раз на `.modal`
(`max-height:min(82vh,780px)` плюс прокрутка внутри), кнопки окна
прилипают к его нижнему краю (`.modal-actions`), а длинные слова в
списках переносятся по буквам (`overflow-wrap:anywhere`) — «11111…» без
пробелов раздвигало окно вбок вместе с горизонтальной полосой. На
телефоне потолок снимается: там окно во весь экран, и это правильно.
Цифра в заголовке окна — та же плашка, что у панелей и столбцов.

**Щелчок мимо окна не выбрасывает форму.** 20.09.2026: «почти заполнил
задачу, случайно тыкнул мимо окна и потерял всю заполненную форму».
`Modal` принимает `dismissOnBackdrop`, и у всего, где ЗАПОЛНЯЮТ (задача,
встреча, разделы, «Команда», выбор даты переноса, вопрос с полем ввода),
он `false`: закрывают «Отменой» и Escape, оба нарочно. У окон, которые
только показывают («Завершённые», «Загрузка»), щелчок мимо остаётся —
терять там нечего.

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

**Ничто не всплывает поверх кнопок НАПОЛОВИНУ.** Календарь в форме задачи
и встречи — шторка: затемнение на всё окно и карточка календаря по центру
(`.cal-sheet-scrim` / `.cal-sheet` в `MiniCalendar`), с мягким появлением.
Слова Кирилла 20.09.2026: «чтобы календарь не расширял окна создания
встречи или задачи, а плавно всплывал поверх окна создающегося события,
мягко, как шторка… и чтобы выглядел красиво, как на главной странице в
блоке календарь — чтобы однотипный был». Поэтому же «сегодня» в нём
теперь рамкой, а выбранный день заливкой — ровно как у `.cal-day`.
До этого он раздвигал форму, и в CLAUDE.md здесь было написано обратное
правило. Оно родилось из настоящей беды: всплывающий календарь ложился на
«Сегодня / Завтра / Через неделю», половину скрывал, половина торчала
сбоку — «кнопки залазят друг на друга». Но раздвигание лечило симптом,
подбрасывая форму на треть экрана. Ошибка была в полумере: календарь
накрывал ЧАСТЬ формы, оставаясь с ней на одном плане. Накрыв её целиком,
спорить стало не с чем. Из этого общее: всплывающее либо накрывает
целиком и гасит фон, либо не всплывает вовсе.
Escape в такой шторке — особый случай. Внутри `<dialog>` он «запрос на
закрытие», который браузер исполняет сам, и `stopPropagation` его не
останавливает: нужен `preventDefault` на `keydown`, иначе один Escape
закрывает и календарь, и форму с набранным в ней. Общий
`useEscapeToClose` этого не делает намеренно — у `MiniCalendar` свой
обработчик, как у `Ask.tsx`.
Строка, которая может не поместиться, — сетка с
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
**И переносит её только тот, кто назначил** (20.09.2026: «удалять и
переносить авторам можно только СВОИ собственные созданные встречи…
просьбы о переносе выражаются в чате внутри каждой встречи»). У чужой
встречи в списке нет ни кнопок итога, ни переноса, ни удаления, и её не
взять мышью — участнику остаются голос («Буду / Опоздаю / Не смогу», и
«не смогу» видно автору в списке) и обсуждение внутри встречи. База это
и так запрещает (миграция 0019), а отказ RLS молчалив — поэтому запрет
обязан стоять и в интерфейсе.

**Карточка встречи устроена как карточка задачи.** Слова Кирилла
20.09.2026: «чтобы внешнее моделирование встреч и задач было однотипное
по расположению ключевой информации о событии». Значит: название
строкой, под ним факты (дата · время · участники), под ними действия.
Действия — со словами, потому что «✓» под встречей одинаково похоже на
«прошла» и на «я приду». Но слов ровно по одному — «Успех», «Провал»,
«Перенос», — и все три стоят в ОДНУ строку (его слова в тот же день).
Целые фразы («Прошла успешно», «Без результата») были верны по смыслу и
неверны по месту: сетка 2×2 занимала под каждой встречей четыре строки,
то есть больше самой встречи, и повторялась у всех в списке. Полное
название осталось подсказкой на наведение. Ряд — grid из трёх равных
колонок (`.meeting-actions`), а не flex-wrap: панель узкая, и общий
перенос рвал бы ряд каждый раз в новом месте.
Удаление из этого ряда ушло: это не исход встречи, а отказ от неё, и
четвёртой кнопкой среди трёх исходов оно стояло не на своём месте.
Крестик вернулся в правый верхний угол карточки (`.meeting-del`) — там
его ищут, — но ЗАМЕТНЫЙ: своя кнопка с рамкой 28px, видимая всегда, а не
значок, проступающий на наведение. Наведения на телефоне нет вовсе, и
невидимая кнопка равна отсутствующей. Прежний довод «крестик у края
читается как „закрыть“» снят подсказкой и вопросом перед удалением.

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
*Списки меряются заново, пока идёт перенос*
(`measuring: { droppable: { strategy: Always } }`). По умолчанию dnd-kit
снимает прямоугольники один раз, в начале, — а список именно в этот
момент и начинает меняться: соседи расступаются, столбец растёт. Дальше
всё считается по координатам, которых на экране уже нет, и щель
открывается не под курсором. Слова Кирилла 20.09.2026: «не раздвигались
первая и вторая строка, а ездили синхронно вверх-вниз». Карточки у нас
намеренно разной высоты, поэтому ошибка копится с каждым сдвигом.
*Потеря фокуса отменяет перенос.* Кнопку мыши можно отпустить не над
трекером — снимок экрана (Win+Shift+S), Alt+Tab, всплывшее окно чужой
программы: отпускание достаётся тому, кто забрал указатель, до страницы
не доходит вовсе, и карточка остаётся висеть на курсоре до перезагрузки
(«приклеилась к курсору и летала по экрану»). Поэтому `window.blur` и
уход вкладки в фон отменяют начатый перенос, и отменяют его Escape'ом:
сенсоры dnd-kit понимают именно его, а публичного «отмени сейчас» у
контекста нет — лезть во внутренности библиотеки ради этого значит
сломаться на первом же её обновлении.
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

**Трекер открывается на прошлом кадре, а не на слове «Загрузка…».**
20.09.2026: «после нажатия на ярлык трекера секунд на 3–5 идёт эта
загрузка, исправь, чтобы он открывался моментально». Три секунды
складывались из трёх ожиданий, и каждое чинится отдельно:
*Роль* (`useWorkspaceRole`) блокировала загрузку данных целиком — пока
неизвестно, чьё это пространство, читать нечего. Теперь ответ прошлого
запуска лежит в `localStorage` под ключом своего auth-id и отдаётся
сразу, а сеть поправляет его фоном. И спрашивается сессия
(`getSession`), а не сервер (`getUser`): второе — это сетевой запрос.
*Данные* лежали в IndexedDB и ждали ОШИБКИ сети, чтобы пригодиться.
Теперь `startFromCache` рисует их первым кадром и при живой связи
(`offline:false`), а пять запросов догоняют и заменяют. Работа, начатая
в эти секунды, не теряется: пара «что показано / что подтвердила база»
снимается перед перезаписью и проходит через тот же `applyLocalChanges`,
которым переносят работу, сделанную офлайн.
*Мелочь в ту же копилку*: `linkTaskAndMeeting` спрашивал `auth.getUser()`
(сеть) ради одного идентификатора — теперь берёт его из `lib/me`.
*Кадра как такового не было.* Пока роль или данные ехали, весь экран был
`<div>Загрузка…</div>`: «сперва появляется чёрный экран и в левом верхнем
углу слово „Загрузка…“» (20.09.2026, уже после ускорения). Теперь ждут
на каркасе трекера — та же раскладка, только пустая (`BootSkeleton`), и
он отрисовывается на сервере, то есть приходит в первом же HTML, до
единой строчки JavaScript. Каркас — картинка: ни кнопок, ни
обработчиков, иначе это второй интерфейс, который придётся чинить дважды.
*Столбцы доски раскладывались на глазах.* Задачи приходят одним
запросом, строки участия — другим, а столбец выводится из вторых: до их
прихода всё лежало в «Новых» и через секунду прыгало по местам (замер:
доска 274 мс, карточка на месте 1100 мс). Поэтому участие тоже
запоминается между запусками (`useTaskParticipants`, ключ — свой
auth-id). Две ловушки, обе стоили по разу: читать кэш надо в ЛЕНИВОМ
инициализаторе `useState` (строка в теле компонента разбирает сотню
килобайт JSON на каждую перерисовку и вешает экран намертво), а писать —
не чаще раза в пару секунд (иначе сериализация попадает в момент, когда
человек ждёт отклика на нажатие).
*В настольном приложении первым открывается splash.html* — локальная
заставка со знаком и строкой «Открываю трекер…». Окно ждёт
`ready-to-show`, а первый кадр сайта не может прийти раньше ответа сети;
без заставки это выглядит как приложение, которое не открылось. Окно
появляется через 360 мс, и `smoke.mjs` это измеряет: файл легко забыть
внести в `build.files`, и тогда заставка молча исчезнет.
Правило на будущее: **на пути к первому кадру не должно быть ни одного
обязательного сетевого ответа.** Есть локальная копия — показывайте её,
сеть догонит. А если копии нет — показывайте форму того, что грузится,
а не слово о том, что оно грузится.

**Рамка окна настольного приложения тёмная** — `nativeTheme.themeSource
= "dark"` в `desktop/main.js`: Windows красит заголовок по теме
приложения. Свою шапку (`titleBarOverlay`) не рисуем: под системные
кнопки пришлось бы двигать всю шапку трекера, иначе «Команда» и «Выйти»
окажутся под «свернуть/закрыть».

**Realtime — ускоритель, а не источник правды** (`lib/revive.ts`). Всё
живое в трекере приезжало ровно одной дорогой — подпиской. Пока сокет
жив, это прекрасно: задача, заведённая в мессенджере, появляется на доске
за долю секунды. Но сокет умирает буднично и МОЛЧА — закрыли ноутбук,
вкладка ушла в фон, моргнул wifi, прокси разорвал соединение по
бездействию, — и после этого не происходит ничего: экран показывает
вчерашний мир, кнопки работают, отказа нет. Плюс целый режим, где подписки
нет вовсе: на сети, которая не пускает к `*.supabase.co`, трекер ходит
через свой домен, а websocket туда не проложить. Слова Кирилла 22.09.2026:
«веб версия тоже работает с большими задержками, чуть ли не обновлять
приходится, чтобы подтягивались вновь созданные события». Обновлять и
правда приходилось: F5 был единственным работающим способом узнать, что в
базе что-то изменилось.
Теперь у данных есть второй путь. `onRevive` собирает поводы перечитать —
человек вернулся к вкладке, вернулась сеть, страница поднялась из кэша
браузера (`pageshow`), поднялся сам канал, и просто раз в минуту, — а
каждый хук с данными на них перечитывает своё: задачи и встречи
(`catchUp` в `useTrackerData`), участие, обсуждение, голоса, общие
справочники. В прокси-режиме чаще: там это единственный путь.
Три вещи здесь ломаются незаметно, если о них не знать.
*Перечитанное СЛИВАЕТСЯ с несохранённым, а не заменяет его.* Пара «что
показано / что подтвердила база» и `applyLocalChanges` — те же самые,
которыми переносится работа, сделанная офлайн; четвёртого способа слить
два состояния в этом файле быть не должно.
*До экрана доходит только изменившееся* (`sameLists` в `trackerSync.ts`).
Иначе доска перерисовывалась бы каждую минуту на ровном месте — в том
числе посреди перетаскивания, которое от перерисовки срывается. Ключи при
сравнении сортируются: один и тот же объект собирают две функции (строка
базы и форма задачи), и порядок полей у них разный, а `JSON.stringify`
считает такую пару разной.
*Догонять пропущенное realtime не умеет* — он рассказывает только о том,
что случилось при нём. Поэтому подъём канала (`SUBSCRIBED`) сам по себе
повод перечитать всё разом, и это половина починки.

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

**Закрытую задачу открывает `REOPEN_PATCH`, и другого выхода нет.** Доска
ходит только вперёд (20.09.2026), то есть назад задача возвращается
кнопкой в карточке, а не перетаскиванием. Кнопки этой не было вовсе, а
то, что на неё было похоже, не работало: галочка «сделано» снимает
`status`, но принятую задачу держит закрытой ещё и `approval_state`, а
эта колонка серверная — снять её из браузера нельзя в принципе. Получалось
состояние без выхода: галочка снята, задача в «Завершённых». Тем же
болели волевое закрытие и «верни в работу» у бота — они писали статус и
ничего больше. Теперь набор колонок один (`lib/reviewWork.REOPEN_PATCH`)
и его зовут все входы: маршрут приёмки (`action: "reopen"`), карточка и
массовые действия бота. Отчёты исполнителей при этом НЕ стираются, в
отличие от возврата на доработку: возврат означает «переделай», а
открытие заново — чаще всего «я закрыл не то», и стирать ради этого
сданную работу дороже самой ошибки. Задача возвращается на приёмку, то
есть туда, где была.

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

**Главное о задаче и о встрече лежит в ОДНОМ И ТОМ ЖЕ месте**
(`ItemFacts.tsx`). Слова Кирилла 21.09.2026: «требуется компактное окно с
основной информацией о задаче… кто постановщик → напротив дата постановки
задачи, кто исполнитель → напротив крайний срок», и тем же днём про
встречу — «окно созданной встречи должно быть однотипным с окном созданной
задачи». Отсюда форма: пары «кто» и «когда» в одной строке (их читают
вместе), списки людей — во всю ширину, у встречи в списке состава стоит
отклик каждого (✓ буду · 🕐 опоздаю · ✕ не смогу · • молчит). Один
компонент на оба окна, и это не экономия: «однотипное» у него значит
ОДНО И ТО ЖЕ МЕСТО, а вторая копия такой разметки разъедется с первой, как
уже трижды разъезжалось в этом проекте всё остальное. Дата постановки взята
из `created_at` самой строки (`createdAt` в типах, только для чтения:
`taskToRow`/`meetingToRow` её не пишут).

**Результат живёт у результата, а не в обсуждении.** Отчёты исполнителей —
отдельный блок в карточке (кто, когда, что именно сделано) плюс документы
при них: миграция 0039, колонка `task_participants.done_files` той же формы,
что вложения обсуждения, в той же закрытой корзине. Просьба Кирилла была
буквальной — «поле Результат с датой и временем проведения и возможностью
прикрепления документа», — и причина в приёмке: акт или фотография нужны
ровно в ту секунду, когда решают, принять или вернуть, а искать их
пролистыванием переписки значит не найти. Файлы в корзину кладёт БРАУЗЕР
(у него есть права по первому сегменту пути, миграция 0020), маршрут
получает только описания: двухмегабайтная фотография через серверную
функцию с её пределом на тело и четырьмя секундами жизни не поедет. Отчёт,
чей файл не загрузился, не уходит вовсе — отчёт без обещанного акта
постановщик прочтёт как полный. В мессенджер уходит ЧИСЛО файлов, а не
ссылка: подписанная ссылка живёт час, а сообщение навсегда.

**Отказ — это ответ, и после него решает постановщик.** 21.09.2026: «после
отказа задача не переносится „на приёмку“». Дело не в столбце: пока отказ
считался состоянием «blocked», задача стояла в «В работе» и не просила
ничего ни у кого — исполнитель уже ответил, а постановщику никто не сказал,
что дальше его слово. Теперь «ответили все» (`taskProgress.allAnswered` —
отчёт ИЛИ отказ) уводит задачу на приёмку из всех дверей сразу: из трекера
(`api/workspace/report`), из мессенджера (`colleagueReplies`) и на доске
(`lib/kanban`). В блоке приёмки при отказе стоит другой вопрос и другие
кнопки: «Принять» появляется только если есть хотя бы один отчёт (принимать
нечего у задачи, от которой все отказались), а «Закрыть волевым решением»
возвращается туда же — до этого вторая дверь пропадала именно на приёмке.
«Не может» на кубике теперь считается по самому отказу (`hasDeclined`), а
не по `stage`: иначе «сдали работу» и «не смогли» выглядели бы в одном
столбце одинаково.

**Escape закрывает ОДИН уровень, даже когда уровень подменён.** 21.09.2026:
«открываешь встречу → нажимаешь „перенести время“ → решаешь, что не хочешь,
и жмёшь esc — закрываются все уровни до начальной страницы». Причина в том,
что перенос не второе окно поверх первого, а ТО ЖЕ окно, переключённое с
встречи на форму новой: для браузера уровень один, и он закрывал его
целиком. Поэтому уровень помнится в `MeetingsPanel.closeModal` — форма
переноса возвращается во встречу, и только следующий Escape закрывает её.
Сохранённый перенос закрывает всё: признак этого лежит в ref, потому что
`closeModal` зовётся формой в ту же долю секунды и нового состояния ещё не
видит. **Прежде чем подменить содержимое открытого окна, ответьте, что
сделает Escape.**

**Enter заканчивает любое заполнение результата.** «Любые заполнения
результатов или итогов должны закрываться нажатием „Enter“ после
заполнения, везде! во всех формах заполнения» (21.09.2026). Это `Ask.tsx`
(многострочное поле тоже, не только однострочное), `AnswerForm` (отчёт,
причина, просьба о переносе) и итог встречи, где Enter значит «завершить
успешно» — исход по умолчанию, о котором подпись под полем говорит вслух:
Enter, срабатывающий неожиданно, хуже Enter, который не срабатывает.
Shift+Enter везде переносит строку.

**Отказ базы — это объект, а не Error.** «Не всё сохранилось в облако (1):
[object Object]» Кирилл увидел 21.09.2026, и это была вся доступная ему
информация: цепочка синхронизации бросала `error` Supabase как есть, а
`String(err)` превращал его в эти два слова — по дороге в `sync_errors`, то
есть ровно там, где строка и хранится для баннера. Теперь `lib/syncError`
собирает `message · details · hint (код)` и называет ТАБЛИЦУ и действие
(«Задачи (запись): …»): без имени таблицы «duplicate key value violates
unique constraint» — загадка. Старые нечитаемые строки баннер не выдаёт за
объяснение, а говорит, что подробностей не сохранилось. Причину той
единственной строки восстановить нельзя — она была потеряна тогда.

**Все встречи назначаются, предложение осталось только в боте.**
«Параметр „как собираем“ убираем. Все встречи должны работать путём
назначения. И если у кого-то не получается присутствовать, организатор
встречи принимает решение, переговорив с человеком» (21.09.2026). Выбор из
формы ушёл, `status: "proposed"` в базе остался — предложить встречу можно
из мессенджера, у уже предложенных работает кнопка «Назначить», и
`meetingConfirm` по-прежнему превращает предложение в встречу, когда
ответили все. Порядок полей новой встречи задан им же: название → дата
(с кнопками «Сегодня / Завтра / Через неделю», как у срока задачи) → время
→ участники → сколько займёт.

**Обсуждение — переписка, а не список карточек** (`ItemChat.tsx`). «Сделай
современный чат… режим чата как в телеграм или МАХ (когда твои сообщения
справа, сообщение коллег слева)». Поэтому: лента со своей прокруткой (иначе
разговор растягивает окно задачи), пузыри на две стороны, кружок с буквами
и цвет имени у чужих реплик (цвет считается ИЗ имени — список людей
меняется, подпись человека меняться не должна), время в углу пузыря,
разделители дней и склейка подряд идущих реплик одного автора. Прежнее
правило «своё отличается рамкой, а не расположением» отменено им же, и он
прав: сторона узнаётся раньше, чем читается подпись.

**Кнопка в мессенджере — там, где от человека ждут ответа.** Правило шире
одного места: каждое сообщение бота, после которого чего-то ждут, обязано
нести кнопку этого действия. Кнопка жила только под тем сообщением, которым
задачу прислали, — переписка уезжала вверх, и отвечать было нечем. Теперь у
коллеги есть свои команды и списки кнопками (`colleagueQueries`), «Ответить»
адресует следующее сообщение конкретной задаче (миграция 0028, живёт два
часа), а переписанное сообщение обязано нести кнопки следующего шага — в
MAX это тем более важно, там нет всплывающих подсказок и переписанное
сообщение и есть весь ответ.

**Порог телефона — 800px, и он записан в двух местах.** `MOBILE_QUERY` в
`useIsMobile` и медиазапросы мобильного блока в `tracker.css` обязаны
совпадать: разметка оболочки и её стили включаются вместе. Было 768 против
1150 у колонок — и между ними лежала полоса без вкладок и без колонок, одна
длинная лента, где до встреч надо пролистать все задачи. Потом было 1000 — и
в эту цифру упёрся сам Кирилл 20.09.2026: «на каком-то этапе сжатия я
заметил, что приложение для ПК переделывается под мобильную версию, а есть
ли более эффективные альтернативы сжатия». Он прав: 1000px — это окно,
развёрнутое на половину обычного монитора, то есть самый обычный способ
работать в двух окнах, и мышь с клавиатурой при этом никуда не делись.

**Окно ПК уменьшается СТУПЕНЯМИ, и они перечислены в одном месте** — блок
«Ступени сжатия окна» в `tracker.css`: ≥1400 три колонки, 1100…1400 две
(календарь опускается под мысли), 900…1100 две (календаря нет), 800…900
одна, ниже — вкладки телефона. Приоритет один и тот же на всех ступенях и
взят из его слов: **задачи → встречи → мысли → календарь**; уходит всегда
последнее и уходит целиком, а не сплющивается в нечитаемое. Раньше порогов
было четыре, стояли они в разных местах файла и ни один не знал о соседях —
это и есть «не хочу, чтобы при сжатии или расширении все блоки беспорядочно
гуляли».
Три вещи здесь легко сломать обратно.
*Порог 1400 выбран доской, а не глазом*: при 1200 три боковые колонки
оставляют ей 536 пикселей, то есть два столбца вместо трёх, и «На приёмке»
уезжает вниз. Отдав календарь, доска получает 822 и остаётся собой.
*Но исчезать календарю рано*: 1280 и 1366 — обычный ноутбук, и пропавшая
панель там читается как поломка. На первой ступени он не исчезает, а
опускается под мысли. Проверено это не рассуждением: e2e полного круга
ищет клетку календаря при стандартных для Playwright 1280 и упал ровно на
первой попытке его спрятать. Переезд между колонками возможен потому, что
зоны на этих ступенях объявлены `display:contents` — иначе календарь не
выбрался бы из общей обёртки со встречами.
*Сама доска считает свою ширину САМА* (`@container` по `.dash-panel`, а не
`@media`): столбцы перестраиваются, когда тесно ИМ, а не когда изменилось
число, о котором они ничего не знают. И каркас загрузки (`.skel-*`) обязан
ломаться на тех же порогах — иначе первый кадр показывает одно, второй
другое, и экран дёргается ровно в тот момент, когда должен успокаивать.

**Телефон: что на нём есть — это список, а не «всё то же, но уже.»**
Тринадцать пунктов Кирилла от 20.09.2026 разобраны в `docs/mobile.md`, там
же его собственные формулировки. Коротко, чтобы не вернуть случайно:
нижняя панель — **Встречи · Задачи · Приёмка · Мысли · Сегодня** (порядок
повторяет расположение блоков на компьютере), сессия начинается с «Задач»
(`DEFAULT_MOBILE_TAB`); в шапке ОДНА кнопка со значком людей, поиск — первой
строкой в её меню; круглая «+» заводит то, в каком разделе нажата (в
«Сегодня» и «Приёмке» её нет вовсе); в полосе над доской только «+»,
«Все / Мне / Я поручил» и «Просрочено»; завершённого на телефоне нет нигде —
ни столбца, ни галочек с числом в панелях («это большая информационная
нагрузка на восприятие»); ни календаря во встречах, ни заголовков, которые
повторяют подпись вкладки. Каждое из этих «нет» — отдельная его фраза, и
каждое возвращается одной случайной правкой, которая больше нигде себя не
проявит, поэтому все они проверяются тестом «на телефоне убрано всё, что
дублирует подпись вкладки».

**Масштаб пальцами выключен** (`viewport` в `layout.tsx`), по его слову
«в мобильном приложении и мини-приложениях не должно быть возможности
увеличить-уменьшить». Цена известна и принята: раз приблизить нельзя,
размеры на телефоне задаются «под палец», а не «помельче, всё равно
увеличат», и поле ввода не мельче 16px (ниже этого iOS приближает страницу
сам). Заодно там появился `viewport-fit=cover`, без которого
`env(safe-area-inset-*)` равнялись нулю — то есть половина отступов
мобильного блока не работала вовсе.

**Диктовка обязана говорить, когда не может.** Кнопка микрофона в
мини-приложении Telegram с компьютера загоралась и оставалась гореть:
встроенный браузер мессенджера отвечает на `recognition.start()` молчанием —
ни результата, ни `onend`, ни `onerror`, — и снаружи это неотличимо от
поломки. Поэтому в `useSpeechInput` есть сторож на запуск: четыре секунды
без `onaudiostart` — и кнопка гаснет с названной причиной
(`speechErrorText`) и путём в обход. Само распознавание внутри мессенджера
от этого не появится, его там нет; не пытайтесь чинить это «ещё раз, но
настойчивее».

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
НО назначить может каждый, кто собирает, а не только владелец
(20.09.2026): право занять час чужого дня у участников одинаковое, а
отказаться может любой. «Назначаю / Предлагаю время» — выбор в форме, и
предложение, на которое ОТВЕТИЛИ ВСЕ, становится встречей само
(`lib/meetingConfirm`), из обеих дверей — карточки и мессенджера. Опоздание
считается согласием, ответ до переноса — нет. Отказ при этом НИЧЕГО не
отменяет и не удаляет: остальные уже спланировали день, а выбор между
переносом и «соберёмся без него» принимает организатор, которому об отказе
говорят сразу. Прежнее правило «назначает владелец» было записано
наполовину: предложенная встреча не становилась назначенной никогда, и
руководитель, собравший двоих и получивший два «буду», оставался без
встречи.

**Встреча занимает ОТРЕЗОК времени, и из него растут три вещи** (миграция
0038, `lib/meetingTime`). Полчаса или час — выбор рядом со временем; два
варианта, а не поле ввода, потому что сетка времени и так получасовая.
*Занятость*: у согласившихся это время видно занятым всем, кто попробует
позвать их тогда же (штриховка на кнопке, имена в подсказке). Помечено, а
не запрещено — поставить встречу поверх другой иногда решают осознанно, и
плохо не это, а вслепую. Гаснут слоты ТОЛЬКО у приглашённых: при
четырнадцати людях «занят хоть кто-то» не оставило бы ни одного свободного
часа. Своя же встреча из расчёта исключена, иначе, открыв её, человек видит
собственное время занятым.
*Конец времени вслух*: предупреждение за 10 минут у часовой и за 5 у
получасовой, потом «время вышло» (`lib/meetingNudges`, слова Кирилла
«бегом работать, хватит болтать»). По одному разу на встречу и только в её
день — иначе крон, добравшийся до вчерашней встречи утром, объявит, что её
время вышло, через сутки после того, как все разошлись.
*Поторопить*: кнопка организатора в мессенджере пишет тем, кто сказал
«опоздаю», и тем, кто молчит; отказавшихся не трогает — они ответили.
Шутки во всех трёх наборах — про ВРЕМЯ и встречу, никогда про человека:
«опять ты» от бота обиднее, чем от человека, и повторяется у всех сразу.

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

**Работа не бросается на полпути — она оставляет записку.** 21.09.2026,
его словами: «если сессия не выполнила все свои задачи и уперлась в
лимиты, чтобы автоматически будилась и продолжала работу, после
обновления лимитов». Сама себя сессия разбудить не может: после
последнего слова её попросту нет до следующего сообщения. Поэтому
механизм из двух половин, и первая — обязанность КАЖДОЙ сессии здесь.

*Записка.* Как только стало ясно, что задача не закончится в этот ход —
кончились лимиты, кончился контекст, что угодно, — пишется файл
`.unfinished\<дата>-<короткое-имя>.md` в корне рабочей копии: ветка; что
сделано и закоммичено, а что лежит незакоммиченным; что осталось — по
шагам, без «и так далее»; чего делать НЕ надо (чужие файлы соседних
сессий, решения, которые он уже принял); чем проверять. Пишется она для
человека, который этого разговора не видел, — следующая сессия его
действительно не увидит. Каталог в `.gitignore`: записки не код, и в
истории проекта им незачем — но и вне рабочей копии им нельзя, см. ниже.

*Дежурный.* Запланированная задача «Доделать незаконченное»
(`~/.claude/scheduled-tasks/finish-unfinished-hourly/`) раз в час
открывает новую сессию, берёт САМУЮ СТАРУЮ записку — одну за прогон, —
доводит её план до конца и переносит файл в `.unfinished\done\`. Не
восстановились лимиты — прогон просто не отработает и повторится через
час.

Переносит, а не удаляет, и это не косметика: автономной сессии
классификатор безопасности запрещает удалять файлы, и первый же пробный
прогон встал ровно на этом — работа сделана, записка на месте, а значит
через час её возьмут снова. Архив полезен и сам по себе: по нему видно,
что и когда доделывалось без присмотра.

Отсюда два следствия, и они важнее механики. **Записка уезжает в архив
только вместе с готовой работой**: пока файл лежит в `unfinished\`, к
нему возвращаются каждый час. И **дежурный не выдумывает** — если в
записке чего-то не хватает или решение принимать Кириллу, он дописывает в
неё «Что мешает» и останавливается, а не решает за него.

*А 22.09.2026 выяснилось, что первый же настоящий случай механизм
проспал целиком*, и разбор этого стоит трёх правил.

**Первое: записки не было.** Она пишется сессией, которая ПОНЯЛА, что не
успевает; сессию, которую обрывают на лимите, не предупреждают, и хода
на файл у неё уже нет. Каталог записок был пуст, а в рабочей копии сутки
лежала готовая работа (корешок роли на карточке) — незакоммиченная и
потому невидимая. След обрыва остаётся всегда и он один: `git status`.
Поэтому дежурный теперь, не найдя записок, смотрит дерево и называет
найденное — но НЕ коммитит его: замысла он не знает, а рядом может
писать живая сессия.

**Второе, и это была настоящая причина: он встал на запросе разрешения.**
Прогон 21.09 в 09:09 сделал ОДИН вызов — `ls` каталога записок по
прежнему адресу `~/.claude/unfinished` — и оборвался на нём: ни ответа,
ни ошибки, ни следующей строки в журнале. Путь лежал ЗА пределами рабочей
копии, а всё за её пределами спрашивает разрешения, и дать его в
автономной сессии некому: она ждёт вечно. Три первых прогона прошли
только потому, что Кирилл в тот час сидел рядом и нажимал «разрешить».
Отсюда правило, которое больше не про записки: **автономная сессия не
должна выходить за пределы рабочей копии ни на один путь.** Каталог
записок поэтому переехал ВНУТРЬ дерева — `.unfinished\`, в `.gitignore`
(в историю проекта им по-прежнему незачем, а `.gitignore` отвечает ровно
на это). Соседнее следствие: разрешения запоминаются НА ЗАДАЧЕ при первом
прогоне, так что новую запланированную задачу первый раз запускают
руками, при человеке — иначе первый же её прогон встанет на диалоге,
которого никто не видит, и утянет за собой все следующие.
Узнаётся это состояние по одному признаку, и он надёжнее любого другого:
**процессы прогона живы, а процессорного времени у них ноль.** Сессия,
которая считает, тратит секунды; сессия, которая ждёт диалога, не тратит
ничего — снаружи же «running» выглядит одинаково. `Get-Process node`
отвечает на это за секунду.

**Третье: зависший прогон блокирует все следующие.** Пока та сессия
числилась running, каждый следующий запуск отвечал «already running» — то
есть дежурный был мёртв ровно сутки, а выглядело это как «ничего не
происходит». Остановить чужую сессию из соседней нельзя (классификатор
безопасности не даёт), поэтому лечилось пересозданием задачи под новым
`taskId`, а прежняя осталась выключенной рядом. **Если дежурный молчит
больше суток — смотреть надо не записки, а список его прогонов:** висящий
`running` там виден сразу, и он же ответ.

И общее, справедливое шире дежурного: **часы задачи идут, только пока
открыто приложение**. Закрытый ноутбук — это часы без прогонов, и кодом
это не чинится.

**Две сессии работают в ОДНОЙ рабочей копии.** Кирилл открывает несколько
чатов сразу, и это не две ветки и не два клона: один каталог, один
`git status`, одно дерево на всех. 18.09.2026 две сессии правили его
одновременно, и разошлось всё, что могло: одна вклинила свой `useEffect`
внутрь чужого комментария, разорвав фразу пополам; вторая не могла
закоммитить свой файл, потому что он уже импортировал функцию из чужого
незакоммиченного; и обе ждали друг друга, пока Кирилл ждал результата.
Правило из этого — четыре строки, и оно не про вежливость, а про то, чтобы
в `main` не уехала половина чужой работы:

- **Объявите файлы, прежде чем их трогать** — и не в сообщении, а в общем
  журнале: `node scripts/claim.mjs take "чем вы заняты" <файлы...>` перед
  первой правкой, `node scripts/claim.mjs list` чтобы увидеть, кто что
  держит. Правило это было записано ещё 18.09.2026 и не работало, потому
  что объявление жило в переписке ОДНОЙ сессии, а вторая её не читает:
  22.09.2026 соседняя сессия поправила файл теста, который в ту минуту
  писала эта. Журнал лежит в `.unfinished/claims.json` (вне git — он про
  сиюминутное состояние машины), захват живёт четыре часа и протухает сам:
  сессия кончается молча, отпустить за неё некому, а список вечно занятых
  файлов хуже отсутствующего. Скрипт НИЧЕГО не запрещает и не блокирует —
  он отвечает, занят ли файл, кем и как давно, а решает сессия. Запрет
  здесь был бы той самой «кнопкой, страхующей плохой конструктор».
  Список чужих файлов — граница; в них не лезут, о них просят.
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

**И e2e у каждой сессии свой — это единственное, что нельзя решить
договорённостью.** Тестовый пользователь заводится на прогон, а имя файла
с ним было одно на рабочую копию: второй прогон писал своего поверх
первого, а его уборка удаляла АККАУНТ, под которым в эту секунду работал
чужой прогон. 20.09.2026 так сорвались два прогона подряд, и оба раза
первые минуты ушли на поиск регрессии, которой не было: половина тестов
падает с «ENOENT .e2e-user.json», остальные — на первом действии после
входа, и выглядит это в точности как поломка трекера. Теперь имя файла
своё у каждого прогона (`e2e/userFile.ts`, метка `E2E_RUN` ставится в
`global-setup` до старта воркеров — они наследуют окружение), а teardown
трогает только свой файл и свой аккаунт. Гонять параллельно можно;
предупреждать друг друга всё равно стоит, но забывчивость больше не
стоит часа.

**Столбец доски — это состояние, а не ярлык.** 19.09.2026 «краткосрочные
и долгосрочные» ушли вместе с самим полем: «критерий краткосрочности или
долгосрочности вообще удали». Доска теперь отвечает на «где задача
сейчас» — Новые, В работе, На приёмке, Завершённые (четвёртый столбец
открывается кнопкой), — и ни один из них не хранится в базе: всё
выводится из строк участия и приёмки (`lib/kanban.ts`). Вторая правда об
одном факте здесь уже была дважды, оба раза разошлась с первой, и третий
раз заводить её незачем.
Из этого следует главное свойство доски: **перетаскивание — действие, а
не перекладывание.** В «В работе» — принять задачу, в «На приёмке» —
отчитаться, в «Завершённые» — принять работу. У каждого перехода есть
тот, кому он позволен (`moveBetween`), и отказ произносится словами, а
не молчаливым возвратом карточки. Отчёт и приёмка требуют комментария,
поэтому перенос ОТКРЫВАЕТ карточку, а не пишет за человека.
**И доска ходит только вперёд** (20.09.2026: «из „новых задач“ можно было
перетаскивать в „в работе“, а из в работе — на приёмку, но в обратном
направлении нельзя»). Вперёд можно через ступень — «Новые» → «На
приёмке» это обычный день того, кто сделал раньше, чем нажал «Принял».
Назад нельзя вовсе: каждый шаг назад — событие с обязательной причиной
(возврат на доработку, открытие закрытой задачи), о котором узнают люди,
и делается он кнопкой в карточке, а не движением руки, которое случается
и по ошибке.
**Перетаскивание ничего не обводит.** Ни силуэт на месте взятой карточки,
ни место, раскрывающееся в соседнем столбце, ни сам столбец не рисуют ни
рамки, ни заливки — пустые столбцы тоже (`.column .empty`). Слова
Кирилла: «убери прорисованные границы (сетку перемещений), чтобы блоки
просто плавали по чёрному пространству, без всяких контуров и
зонирований». Куда встанет карточка, говорят расступившиеся соседи и она
сама под курсором; три контура одновременно читались как разметка, в
которую надо попасть. То же в мыслях и встречах. Единственное
исключение — день календаря (`.cal-day.drag-over`): из тридцати клеток
без подсветки не понять, в какую попадёшь.
**У «Новых» нет исключений — в том числе для задачи самому себе.**
22.09.2026 Кирилл завёл задачу на себя, увидел её сразу в «В работе» и
назвал это ошибкой: «сперва все задачи должны создаваться в колонке
„новая задача“». До этого правило было обратным и звучало убедительно:
«Новые» значит «отправлена, ждём ответа человека», а отвечать самому себе
некому. Но столбец читают не так — его читают как «ещё не начал», и
задача, заведённая себе, это запись о том, что предстоит, а не о том, что
уже идёт. Вместе с исключением ушёл и весь расчёт под ним (сравнение
имени автора с именем единственного исполнителя в `TasksPanel`): «Принял»
человек нажимает и себе — одним нажатием или переносом карточки, как все.
Прежде чем вернуть исключение как самоочевидное, перечитайте это; сторож —
`describe("columnOf — задача самому себе")` в `kanban.test.ts`.

**Роль — это КОРЕШОК карточки, а фон принадлежит сроку.** Полоска 4px у
левого края: фирменная у исполнителя, фирменная приглушённая у
соисполнителя, серая у наблюдателя, едва заметная там, где я ни при чём
(`lib/myRole.ts`, переменные `--role-bar-*` в `tracker.css`,
`.task-role-bar` в `TaskCard`). Раздел от этого переехал полоской к
ПРАВОМУ краю — левый занят ролью, а раздел ищется глазом по цвету с
любой стороны.
Важность в своё время стала точкой в углу по той же причине, по которой
роль ушла с фона: «высокий приоритет» и «моя задача» спорили за один
фон, и выигрывал тот, кто ниже в файле.
Просрочка теперь говорит ДВУМЯ разными способами, и путать их нельзя
(выбор Кирилла 21.09.2026 — «мне нравится идея с выделением лёгким
красным просроченных задач, которые ставил я, а как выделять
просроченные, которые ставили мне?»). Своё горящее — там, где я
исполнитель или соисполнитель, — краснеет ЗАЛИВКОЙ: работа на мне.
Горящее, которое поручил я, краснеет только корешком, а фон остаётся
обычным: при четырнадцати людях сплошной красный перестаёт что-либо
значить. Красная дата остаётся у всех — иначе «горит» неотличимо от
«идёт». Наблюдателю не красится ничего, кроме даты: серый корешок важнее
чужого срока.
Авторство цветом НЕ показывается, и это решение: «я поручил» — не
свойство задачи, а режим взгляда на неё, и живёт он переключателем
«Мне / Я поручил / Все» над доской. Третий смысл в цвете превратил бы
доску в тот самый «цветовой сыр-бор». Переключатель появляется только
там, где работают вместе, и пока его нет, фильтр не применяется вовсе:
иначе человек остался бы с суженной доской и без кнопки, которая это
снимает.
**И роль не красят прозрачностью.** 21.09.2026 Кирилл завёл задачу на
себя и сказал: «никаких признаков отличия там где я соисполнитель и
наблюдатель». Правило при этом работало: класс на карточке стоял, роль
считалась верно, тесты были зелёные — они проверяют КЛАСС. Невидимыми
были цвета. Соисполнителю доставалась рамка `--line` (#445157), а
обычной карточке `--line-soft`, то есть rgba(255,255,255,.09) поверх
#2E383C = #414A4E: тот же цвет. Наблюдателю доставался светлый фон и
вместе с ним `opacity:.72`, а прозрачность на тёмном фоне не приглушает,
а СМЕШИВАЕТ с подложкой — светлый фон возвращался к #303B40 против
#2E383C у обычной карточки, две единицы на канал. Отсюда три вывода.
*Приглушить на тёмном — значит приблизить к фону*, то есть стереть то,
что собирались показать; приглушённость делается своим цветом, а не
прозрачностью. *Тона сравниваются попарно и с обычной карточкой*, а не
каждый сам по себе: карточки лежат в одном столбце, и «отличается»
значит «отличается от соседней». *Сторожа два, и оба нужны*:
`src/lib/roleTones.test.ts` считает расстояние между `--role-bar-*`
прямо по файлу стилей, а `e2e/roles.spec.ts` заводит шесть задач
(четыре роли плюс две просроченные) и спрашивает у браузера вычисленные
цвета — первый ловит цифру, второй то, что правило вообще доехало до
страницы.
**И главное, что он ответил, когда тона наконец развели:** «чет не
совсем мне нравится визуальные разделения в этом исполнении». Разведены
они были правильно и всё равно читались плохо, потому что три близкие
ЗАЛИВКИ приходится сравнивать друг с другом, а полоску узнают не
сравнивая. Прежде чем усиливать цвет, спросите, не в носителе ли дело:
четыре варианта (заливка, корешок, подпись словом, «цветом только моя
работа») были показаны ему картинкой, и выбор занял одну реплику вместо
ещё одного круга догадок.

**Приоритета в трекере нет.** 20.09.2026, одной строкой: «удали везде
приоритетности, они не нужны». Ушло всё: поле в форме, точка в углу
карточки (её же он и не смог опознать — «это что?»), сортировка по
важности, цвет точки в календаре, разбор «срочно» в надиктованной фразе
и упоминания в сообщениях бота. Колонка `priority` осталась в базе и в
типе — новые строки пишут в неё `med`, старые никто не переписывает.
Причина та же, что у «срочности» днём раньше: значение ставилось один раз
при заведении и дальше говорило не о деле, а о настроении, в котором его
записали. Что горит — отвечает срок, где задача — доска.

**Нажатие кнопки не двигает соседние кнопки.** 20.09.2026: «не хочу,
чтобы в трекере нажатие одной кнопки двигало другие кнопки или разделы».
Поэтому счётчика на «Завершённых» нет вовсе (он появлялся ровно в момент
нажатия), пилюля «Загрузка» имеет постоянную ширину с местом под крестик,
а мобильная кнопка фильтров не меняет подпись со «Скрыть фильтры» на
«Фильтры». Общее правило шире: если состояние кнопки меняет её ширину —
меняйте цвет, а размер держите.

**В разделах левая кнопка заводит задачу, правая отбирает.** 20.09.2026,
ровно наоборот тому, что было принято днём раньше: «если левой кнопкой
мыши — создаётся задача, если правой — делается отбор». На телефоне
правой кнопки нет, а долгое нажатие занято перестановкой, поэтому там
нажатие делает отбор — раздел выбирается в форме новой задачи.
Кнопка «Все» отвечает на ОБЕ кнопки мыши: отбор ставится правой, и рука
снимает его тем же нажатием. Без этого правый щелчок по ней открывал меню
браузера, то есть единственный выход из отбора выглядел сломанным.
Общее из этого: если действие в ряду делается необычной кнопкой, то и
кнопка, которая его отменяет, обязана понимать её.

**Справочники — админские.** «Кнопки с возможностью добавить раздел или
человека должны быть только у меня, как у администратора» (20.09.2026).
Люди и разделы общие на всё пространство: заведённый кем угодно человек
появится у всех четырнадцати. Граница — `isAdmin` в `TaskModal` («+
человек», «+ раздел», «✕ удалить раздел»); база держит ту же (миграция
0031). Строка разделов над доской задач (`SectionTabs`) с 21.09.2026 не
показывается остальным вовсе — его слова: «эту строку убери у остальных
пользователей, кроме меня, она для них не информативна» — и на телефоне
тоже («она там заполняет место просто»). Решает это `TasksPanel`, рендеря
`SectionTabs` только при `isAdmin && !isMobile`; сам компонент своего
`canEdit` больше не знает — ветки «а если менять нельзя» ему не нужны,
раз его не рендерят никому, кому нельзя.

**Имя человека — «Имя Фамилия», и меняется оно маршрутом, а не UPDATE'ом.**
21.09.2026: «переделай имена всех пользователей по единому формату сначала
имя потом фамилия, а то сейчас у всех в разнобой идёт». Разнобой был в
одной строке («Котов Михаил» среди четырнадцати «Имя Фамилия»), плюс у
самого Кирилла фамилии не было вовсе — его строка звалась «Кирилл (я)», и
с тех пор, как пометка перестала показываться остальным, они видели его
как одного «Кирилла» в списке из пятнадцати. Теперь «Кирилл Кучеренко (я)»,
и это ответ на его вопрос «а как они меня видят?»: посмотреть на это можно
в «Команде» — своя строка там больше не прячется и подписана «это вы».
Само переименование трогает ТРИ места разом, и поэтому живёт в
`/api/workspace/rename-person`: строка в `assignees` — это ЧЕЛОВЕК (по её
id держатся участие, голоса, разделы, чат), а `tasks.assignee` и
`meetings.participants` — это ИМЯ, написанное на карточке, по которому
человека находят триггер 0024, `assignExecutors` и сводки. Переименовать
строку и забыть про задачи — это «назначено только на словах» из аудита
15.09.2026. Пометка «(я)» при этом сохраняется маршрутом, а не человеком:
по ней трекер узнаёт собственную строку владельца. Из трекера это кнопка
«Имя» в меню ⋮ у каждой строки «Команды»; без трекера —
`node --env-file=.env.local scripts/rename-person.mjs "Старое" "Новое"
--space <user_id> [--apply]`.
Порядок людей от формата не зависит: `peopleOrder` ищет ранг по ЛЮБОМУ
слову имени — заведут «Петров Иван», и он встанет где положено.

**Название раздела правится в самой строке, и строка эта — сетка.**
20.09.2026: «сделай чтобы все разделы влазили в одну строку! И добавь
возможность редактирования названия раздела». Два требования оказались
одним: место под кнопки в `SectionsModal` отнимала кнопка «Название»,
которая открывала окно вопроса ради одного слова и притом не говорила,
что имя вообще можно менять, — подпись называла поле, а не действие.
Теперь имя стоит в поле (`SectionName`) и пишется сразу, как текст
задачи: Escape здесь закрывает окно целиком (так устроен
`useEscapeToClose`), поэтому ждать «Сохранить» набранному нельзя. Пустое
имя в базу не уходит, а поле, оставленное пустым, возвращает прежнее.
Ряд собран сеткой (`.section-row-head`), а не `flex-wrap`: у
одиннадцати разделов перенос рвал строку каждый раз в новом месте —
у длинных имён «Удалить» уезжала вниз, у коротких оставалась, и
исправный список читался как сломанный (то же правило, что у
`.team-row`). Подпись «Ответственные» стала «Люди» с числом в плашке и
больше не превращается в «Свернуть»: смена подписи двигала соседнюю
«Удалить» под рукой.
**А людей раздела выбирает то же поле, что и людей на задаче**
(`PeoplePicker` с пропсами `label`/`hint`/`requireExecutor`). Своё окно
спрашивало дважды — «кого добавить» списком кнопок и «кем он будет», — и
первый список был обрезан двенадцатью: при пятнадцати именах двое
последних для раздела не существовали вовсе, и об этом не говорилось ни
слова («показывает не всех людей»). Обрез в списке ЛЮДЕЙ — всегда
ошибка: список кончается тихо, и человек винит себя, а не список. Если
кнопок действительно много — это повод за ними прокручивать, а не
прятать хвост.

**Галочка на карточке — слово постановщика, и у чужой работы она стоит
денег.** 20.09.2026: «ставить быструю галочку на завершение может только
автор задачи, но если задача поставлена не самому себе, а другому
участнику, должно требоваться заполнение „Результата“». Поэтому галочки
у исполнителя нет вовсе (и свайпа на телефоне тоже — `canComplete` в
`TaskCard`), а у постановщика она ведёт себя по-разному: своя задача
закрывается одним нажатием, задача, отданная человеку, спрашивает
результат и уходит обычным путём — приёмкой, если по ней отчитались, и
волевым закрытием, если нет (`quickDone` в `TasksPanel`, оба через
`/api/workspace/review`). Разница не в строгости, а в том, кто ещё
узнает: закрытая молча чужая задача выглядит для человека как отменённая.
На экране «Сегодня» участников нет под рукой, поэтому там сравнивается
имя в поле «Исполнитель» — приближение в сторону строгости: лишний раз
откроется карточка, а не закроется молча чужая работа.

**Отвечают там, где работа, а не на экране над ней.** Отдельного раздела
«Что от вас ждут» больше нет — Кирилл назвал его «глупо построен и не
продуман», и это правда: одна и та же задача жила в двух местах, а
кнопки были только в одном. «Принял / Сделал / Не могу / Прошу перенос»
стоят в самой задаче (`TaskAnswer`), «Буду / Опоздаю / Не смогу» — в
самой встрече (`MeetingAnswer`), «В работу» — на присланной мысли. Все
идут через `/api/workspace/report`, тот же маршрут, что и кнопки в
мессенджере: правила (обязательный комментарий, переход на приёмку,
сообщение постановщику) должны быть в одном месте.
Владелец в этом маршруте — тоже исполнитель. Строки членства у него нет и
не будет, поэтому его собственная строка ищется по метке «(я)» в списке
людей; без этого «Сделал» по задаче, которую ему поставил руководитель,
отвечало «Вы не участник этого трекера».

**Раскладка панелей жёсткая.** «Первым делом убираем возможность
переносить блоки, они всё же должны быть статичны». Порядок зон написан в
`DashboardLayout` и больше нигде; `panel_layout`, ручки в шапках панелей и
панельная половина dnd-контекста удалены. Раскладка — это место, о
котором договорились: «календарь слева, задачи посередине» должно быть
правдой для всех четырнадцати, иначе объяснить что-либо по телефону
нельзя. Перетаскивание осталось работе: карточкам, мыслям, встречам.

**Права разведены на две границы.** `isAdmin` — структура пространства
(разделы и ответственные за них); её Кирилл может отдать другому, роли
`admin` и `developer` в `workspace_members` (миграция 0036). `isOwner` —
«Команда»: приглашения, отключение доступа, отвязка мессенджера и раздача
самих ролей; это остаётся за ним. Обе границы стоят и в интерфейсе, и
политиками базы. Там же и `section_assignees` — кто отвечает за раздел:
правая кнопка по разделу заводит задачу с этими людьми и их ролями.

**Кнопки «Подключить Telegram/MAX» в шапке — владельцевы.** Они
привязывают чат к учётной записи, а у руководителя чат живёт в его строке
в списке людей: туда бот шлёт задачи и кнопки. Пока экран руководителя был
отдельным, спутать было негде; теперь трекер один, и эти кнопки привязали
бы его чат не туда — молча, при полной уверенности, что он подключился.
Руководитель подключается полосой над доской (`MessengerLink`), и она
исчезает, как только подключился.

**Завершённое — окно, а не режим.** Общий переключатель подмешивал
закрытые встречи и вычеркнутые мысли прямо в рабочие списки; список дел,
где половина строк перечёркнута, перестаёт быть списком дел. У каждой
панели своя зелёная галочка со счётчиком, открывающая окно
(`DoneListModal`), а переключатель «Завершённые» остался только доске.
Встреча, которая прошла, а итога не имеет, из списка не уходит: она
отделяется группой «Нужен итог» наверху (`awaitsRecap`) — закрыть её
автоматически значило бы выдумать, чем она кончилась.

**Встреча помнит задачу, из которой выросла** (`from_task_id`, миграция
0037), и её итог дописывается в обсуждение этой задачи. Связь строкой в
переписке осталась — её читают, — но машине нужен идентификатор, а не
текст реплики.

**Задача, принесённая в блок «Встречи», СОЗДАЁТ встречу и остаётся на
доске.** 21.09.2026: «при переносе задачи во встречу встреча не
создаётся… встречи должны мочь создаваться и из списка новых задач, и из
списка задач в работе, и из списка „на приёмку“, так как я допускаю, что
окончательная приёмка задачи возможна только после личного разговора».
Зона принимала одну только мысль, и задачу приходилось нести на день
календаря — путь был, но не тот, который пробуют первым: блок встреч
ближе, крупнее и назван словом. Теперь `useDropHandler("task")` стоит и в
`MeetingsPanel`, а зоной сделана ВСЯ панель, а не список под шапкой: при
нуле встреч список — это одна строка «Встреч пока нет», и целиться в неё
мышью значит промахиваться. Столбец доски при этом не смотрится вовсе —
разговор о задаче уместен на любой её стадии.
Задача не исчезает: встреча — разговор О ней, а не замена ей, и после
встречи к задаче возвращаются за итоговым действием.
**А успешная встреча совершает это действие сама**
(`meetingRecap.approveTaskFromMeeting`): задача, которая ЖДАЛА ПРИЁМКИ,
принимается тем же комментарием, что записан итогом встречи. Так приёмка
и происходит на самом деле — работу принимают разговором, а нажатие лишь
записывает его; без этого задача оставалась в «На приёмке» после встречи,
на которой её как раз и приняли, и утренняя сводка спрашивала о ней снова.
Границ три, и каждая нужна. *Только из «На приёмке»* — успешная встреча
по задаче в работе означает «договорились, как делать», а не «сделано»;
столбец считается так же, как его считает доска (либо `awaiting_review`,
либо отчитались все исполнители — вторая проверка обязательна, потому что
`awaiting_review` проставляет только ответ через маршрут). *Только
постановщиком* — собрать встречу вправе каждый, принять работу тот, кто
её поручил; чужая встреча итог в задачу всё равно допишет, но закрывать
её не станет. *Комментарий тот же самый* — два разных текста об одном
решении расходятся. Правило одно на оба входа: маршрут
`/api/workspace/recap` (ему вкладка шлёт теперь `outcome`, потому что
статус встречи — колонка движка синхронизации и серверу не виден) и
`closeMeeting` в мессенджере, которому ради этого передают актора.

**Windows/Git Bash:** heredocs eat backslashes, so a patch script written
with `cat <<'EOF'` mangles `\n` and regexes — use the Write/Edit tools for
anything containing a backslash. `next build` fails on `.next` files locked
by a running `next start` (and by OneDrive) — stop the server first.

## Open threads

- **Телефон, мини-приложение и сжатое окно ПК — СДЕЛАНО 20.09.2026.**
  `docs/mobile.md` — тринадцать пунктов Кирилла его же словами, что по
  каждому сделано, и восемь рекомендаций на потом (свайп между вкладками,
  быстрые действия свайпом по карточке, поиск в нижнюю панель, вход в MAX
  одноразовой ссылкой) вместе с одной вещью, которую делать НЕ надо, хотя
  она напрашивается: пуш-уведомления вместо мессенджера. Читать прежде,
  чем трогать мобильную оболочку.

- **Мессенджер как полноценный трекер — СДЕЛАНО 20.09.2026.**
  `docs/bot-menu.md` — задача в словах Кирилла («значительно удобнее
  мобильной версии»: люди вне офиса приложение открывать не станут, а
  мессенджер у них открыт всегда), пять разрывов, которые были, и что с
  каждым сделано. Читать прежде, чем трогать кнопки бота.

- **Как трекер работает, одним документом.** `docs/how-it-works.md` —
  жизнь задачи, встречи и мысли, кто что может, что кому приходит и чего
  в трекере нет намеренно. Написан 19.09.2026 по просьбе Кирилла
  «выработать чёткую логику работы трекера». Читать его стоит раньше
  кода: код ему следует, и если они разошлись — прав документ.

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
- **The MAX mini-app is CONNECTED — 20.09.2026, by Кирилл himself.**
  `https://task-tracker-beta-ebon.vercel.app/app`, button «Открыть», in
  business.max.ru → Чат-боты → бот → ⋮ → Настройки. The cabinet accepted
  the path despite listing only letters, digits, dot and hyphen as legal
  characters, so the slash is fine after all — but the fallback that made
  the bare domain work too (the /login interception, `lib/messengerLaunch`)
  stays: it costs nothing and the next field may be stricter.
  The two-year-old worry turned out to be smaller than it looked. Saving
  puts the bot back through moderation («Изменение информации потребует
  повторной модерации»), and the bot kept answering the whole time —
  checked within the minute: `platform-api2.max.ru/me` returned 200 with
  the command list intact, the webhook subscription still pointed at our
  domain, and the MAX half of `test:bots` passed. **Do not read that as a
  promise**: it is one observation of one edit, the platform documents
  nothing about it, and the next change may behave differently. Warn the
  people who use MAX before touching that screen again.
  **While it re-moderates, the Настройки tab goes disabled** — the same
  thing a brand-new bot does (see the entry above), and it looks exactly
  like the settings were lost: no link in the field, no token. It is not
  lost. The token the tracker uses lives in `bot_settings` and keeps
  working the whole time, and the cabinet fills the fields back in once
  approval lands. Check whether the bot is actually fine with
  `platform-api2.max.ru/me` and the webhook subscription, not by looking
  at that screen.
  The code behind it: `/app` plus `/api/max/miniapp-auth`, same signature
  algorithm as Telegram, verified end to end against production with the
  real bot token (owner and manager signed in, forgeries refused).
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
  cannot be switched off. «Покажи это ещё и Ане» осталось, но не в форме:
  кнопка отправки стояла рядом с «Сохранить», и 21.09.2026 Кирилл сказал о
  ней прямо — «что значит эта нижняя серая дополнительная кнопка
  „отправить“? там предлагается выбор кому отправить вне задачи??? что за
  бред? где логика? удали её за ненадобностью». Он прав: в ряду сохранения
  она читалась как второй способ поручить, хотя задача уходит исполнителю
  сама. Теперь ✈ живёт только там, где отправка и есть отдельное действие —
  в меню карточки (⋮ на телефоне) и в «Сегодня». Из окна задачи и окна
  встречи она убрана вместе с `SendMenu`; вернуть её туда — значит вернуть
  тот же вопрос.
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
