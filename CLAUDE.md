@AGENTS.md

# РОКАС — a personal task tracker

**Передача команде компании.** Кирилл передаёт трекер своим программистам
(во главе с Никитой Долговым) для встраивания в приложение компании.
`docs/HANDOFF.md` — точка входа для них: цель, концепция, подходы, карта
системы, что учесть при внедрении. Меняете концепцию, правило или
крупную функцию — обновите и его в том же коммите.

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

**Равноправие и конфиденциальность — концепция трекера (20.10.2026).**
Его слова: «концепция трекера теперь исключительное равноправие всех
участников, которые его используют, и конфиденциальность личных данных».
Из этого прямо следует, чего в трекере НЕТ: пятничного закрытого отчёта
владельцу об активности каждого человека и о том, «кто с кем работает»
(`lib/ownerWeekly`, 06.10.2026) — он удалён целиком по его же просьбе.
Отчёт был обменом за отказ от видимости чужого 23.09.2026; теперь обмена
нет: владелец не видит о чужой работе ничего — ни на экране, ни сводкой,
ни числами. Не предлагайте вернуть его в любом виде — ни «только цифрами»,
ни «надёжность исполнения по людям», ни матрицей взаимодействий: любая
сводка о людях, которую получает один человек, — это и неравенство, и
утечка. Каждый получает статистику только о СВОЕЙ работе (`my_week`).
29.10.2026 найден и удалён последний хвост — понедельничная «📊 Неделя по
людям» владельцу (`composePeopleReview`: «стоит спросить лично», встречи
без итога по всему пространству). От неё осталась только проверка
«назначено на словах» по его СОБСТВЕННЫМ поручениям (`assignmentDrift`).

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
  **Последняя команда перед словом «готово» — `node scripts/unmerged.mjs`.**
  07.10.2026 одна сессия дважды за сутки оставила закоммиченную и
  проверенную работу в своей ветке (`qa/full-frontend`, пятнадцать, а потом
  ещё шесть коммитов вместе с неприменённой миграцией) — правило выше она
  читала, а на боевом этого не было, пока не заглянула соседняя сессия.
  Скрипт отвечает одной строкой: всё ли в `main` и что осталось в дереве;
  пока он отвечает «✗», задача не закончена. Миграцию из своей ветки
  применяет тот, кто вливает, — сразу ПОСЛЕ пуша кода, если код только
  сужает права, и ДО него, если код без неё не работает.
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
                      # человека сразу во всех трёх местах, напоминание
                      # организатору об итоге встречи. 141 проверка.
                      # Written 15.09.2026 because nothing covered any of this.
npm run test:ten      # ДЕСЯТЬ одноразовых аккаунтов против продакшна:
                      # кольцо поручений (каждый — следующему) с пятью
                      # путями закрытия, задача на пятерых с ролями,
                      # десять встреч (голоса, занятость, итог, провал,
                      # отмена, перенос), мысли (отправить, поделиться,
                      # сохранить и переслать копию, взять в работу, в
                      # задачу коллеге, во встречу) и в конце сверка
                      # «каждый видит ровно своё» по всем трём таблицам.
                      # 169 проверок. Аудит 20.10.2026 — там, где людей
                      # больше трёх и поручает не владелец.
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
- `src/lib/quickAdd.ts`, `meetingNotes.ts`, `managerBrief.ts`, `weeklyReview.ts`,
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

**И подписка тоже сливает, а не заменяет** (`mergeIncoming` в
`trackerSync`, 07.10.2026). Тот же урок с третьей стороны: эхо ПЕРВОЙ
записи встречи пришло realtime'ом после того, как человек нажал «Успех», и
обработчик писал его и в экран, и в тень — «Успех» пропадал с экрана, а
дифф его больше не видел. Поймал это боевой e2e под нагрузкой («закрытие
встречи из списка спрашивает итог» падал в общем прогоне и проходил в
одиночку — та самая форма флейка, за которой прячется потеря данных).
Теперь тень всегда берёт строку базы, а экран — только если на строке нет
неотправленной работы.

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

**Приватность держит БАЗА, а не экран — и для владельца тоже** (миграция
0057, 14.10.2026, его слова: «СТРОГО ПРОВЕРЬ КОНФИДЕНЦИАЛЬНОСТЬ… НИ В
КАЧЕСТВЕ УВЕДОМЛЕНИЙ НИ В ДРУГИХ ФОРМАХ»). До неё каждая политика чтения
начиналась с `user_id = auth.uid()`, а `user_id` строк пространства — id
владельца: Кирилл получал в браузер (и в офлайн-копию, и в события
подписки) все чужие задачи, встречи, МЫСЛИ и переписки, а экран их только
прятал. Теперь правило одно — `can_see_item()`: в своём пространстве И
(автор `coalesce(created_by, владелец)` ИЛИ участник ИЛИ — у встречи —
имя в списке). `my_assignee()` знает строку владельца «(я)». Файлы в
корзине читаются по тому же правилу (`can_see_file`) — до этого любой
руководитель перечислял ВСЕ вложения пространства; реакции — по видимой
реплике; `assignees.pending_action`/`pending_reply_*` закрыты от браузера
правами столбцов (там бывает надиктованное и неподтверждённое), поэтому
`select("*")` из таблицы людей в браузере ломается — перечисляйте столбцы.
Занятость в форме встречи — `busy_slots()` → `useBusySlots`: кто, день,
час, длительность, без названия. Серверная сторона (служебный ключ
обходит политики) обязана фильтровать сама: сводки, ассистент
(`trackerContext`), обзор недели, «назначено на словах», резервная копия
— «своё и где участник» (`involvedFilter`, `lib/ownerVisible`).
Отчёта владельцу о чужой работе нет вовсе (см. «Равноправие и
конфиденциальность» в начале файла).
Сторож — раздел «Каждый видит только своё» в `test:schema`.
**Служебные функции прав живут в схеме `private`** (миграция 0063,
15.10.2026): API публикует КАЖДУЮ функцию из `public` (REST `rpc/…` и
GraphQL), и `task_author('<id>')` отвечал любому вошедшему мимо самих
прав. Новую функцию такого рода кладите в `private` и зовите
`private.can_see_item(…)`; в `public` из SECURITY DEFINER остаётся только
`busy_slots` (сторож в `test:schema`). **И код со служебным ключом
проверяет «видит ли», а не «то же пространство»** — `lib/itemAccess.seenItem`,
копия `can_see_item`. Аудит нашёл это в четырёх кнопках бота: обе
«💬 Ответить», «Кто идёт» и кнопки присланной мысли проверяли только
пространство, и подделанное нажатие (сторонний клиент мессенджера)
показывало заголовок, состав или текст чужого дела. Новый обработчик
кнопки с id дела — сперва `seenItem` (или выборка по своей строке
участия), потом всё остальное.

**Server-to-server routes** must be listed in `src/lib/supabase/middleware.ts`
or the session middleware redirects them to /login and they answer 405 with
nothing in the logs.

**Service worker** (`public/sw.js`): «/» и `/app` — СНАЧАЛА копия из кэша,
свежая версия фоном (с 14.10.2026); прочие навигации network-first;
cache-first for `/_next/static`. Копия первой — не вкус, а ответ на «белый
экран, дальше которого ничего не происходит»: сеть, режущая `vercel.app`
по имени, не отказывает, а молчит, и network-first ждал её вечно при
готовой копии в кэше. Устаревшую копию снимает `VersionWatch` (сверка
версии при старте), а битой она не бывает: Vercel отдаёт файлы прежних
сборок (проверено — 200). Повторный вход из мессенджера тоже не ждёт
сервера: `/app` при живой куке сразу уходит на «/», подпись проверяет фоном
`MiniAppChrome` (`switched` в ответе — открыл другой человек). Сторож —
`e2e/instantOpen.spec.ts`; на прежнем воркере он падал по таймауту. never caches "/" at install (it redirects to
/login and a redirected response cannot answer a navigation), and is disabled
and unregistered in development — a stale dev chunk once looked exactly like
a broken feature.

**Новый внешний адрес — сразу в CSP** (`next.config.ts`). 07.10.2026 все
фотографии в отчётах и обсуждениях показывались битым значком: файл в
хранилище был целым, а политика разрешала картинки только со своего домена,
подписанные же ссылки ведут на хост Supabase. Браузер отказывает МОЛЧА —
ни ошибки в интерфейсе, ни строки в журнале поломок, только запись в
консоли, которую никто не открывает. Поэтому всё, что грузится не с
нашего домена (картинка, видео, встроенное окно), прежде всего добавляется
в свою директиву (`img-src`, `media-src`, `frame-src`). И проверяется
картинка по `naturalWidth > 0`, а не по наличию `<img>`: битая картинка
тоже `<img>` (`e2e/attachments.spec.ts`). Вложения рисует один
компонент — `FileList.tsx` (миниатюры и окно просмотра) — для отчёта и
обсуждения; третьего места с файлами без него быть не должно.

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
установленного PWA) и запуск без сети.
**После неудачной загрузки окно Electron НЕ РИСУЕТ больше ни одной
страницы** (21.10.2026, Макаров: «Открываю трекер…» навсегда при заголовке
«Нет связи»). Страница грузится и коммитится, а кадр пустой — даже у
заставки, — и на экране остаётся прежняя картинка. Поэтому отказ не
переводит окно на `offline.html`, а ЗАМЕНЯЕТ его новым того же размера
(`showOffline`); молчащую сеть ловит сторож — 20 с без кадра сайта на
каждом уходе на сайт. `smoke.mjs` проверяет три отказа (нет сервера,
обрыв, молчание) и повтор по кнопке — по снимку кадра (`capturePage`), а
не по тексту: текст говорил «Нет связи» и тогда, когда видно было
заставку. Пустой кадр в проверке — провал, а не «окно не отдало кадр».
**Первый релиз выпущен 19.09.2026: v1.0.1**
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

**`*.vercel.app` в России режется по ИМЕНИ, а не по адресу** (замер
14.10.2026, Globalping, 40 российских сетей): наш адрес открывался в 15 из
40 (МТС, Билайн и большинство домашних — нет), а `vercel.com`, `ya.ru` — в
40 из 40, Supabase напрямую — в 39 из 40, сторонний сайт со СВОИМ доменом
на тех же серверах Vercel (`ui.shadcn.com`) — в 37 из 40. TCP до того же
IP с заблокированного узла проходит, рвётся TLS: фильтр смотрит на SNI.
Значит, лечит это свой домен, подключённый к этому же проекту Vercel, и
больше ничего — прокси `/sb` не поможет, он сам живёт на `vercel.app`.
Проверять Россию С ЭТОЙ МАШИНЫ нельзя: она выходит в сеть через VPN
(ipinfo показывал Алматы), и отсюда всё «работает». Замер — с узлов в РФ:
`check-host.net` (три узла, API без ключа) и `api.globalping.io` (десятки
сетей по `country: "RU"`, около 6 замеров в час с одного IP).
Когда домен появится: `vercel domains add`, затем ссылки ботов переедут
сами (`trackerUrl` читает `VERCEL_PROJECT_PRODUCTION_URL`, а Vercel ставит
туда самый короткий свой домен) — но НЕ сами переедут адрес в
`desktop/main.js` (нужен выпуск оболочки), адрес мини-приложения в кабинете
MAX (ставится руками и уводит бота на модерацию) и Site URL в Supabase. Вход
и установленное PWA привязаны к адресу: на новом домене все входят заново.
**22.10.2026 повторилось как «мобильное приложение — белый экран,
Повторить попытку»**: 20 из 30 сетей РФ (МТС — нет), а `ui.shadcn.com`
теми же узлами в ту же минуту — 30 из 30; журнал поломок пуст, 20
телефонных e2e на боевом зелёные. Домен можно купить ОТСЮДА: Vercel CLI
вошёл (`kirill900504`, команда `team_a0zwhXJt4OE9dGNdglcJovkv`), API
регистратора — `/v1/registrar/domains/<имя>/availability` и `/price`
(старые `/v4/domains/*` закрыты), `.ru` Vercel не продаёт,
`rokas-tracker.com` был свободен за $11.25/год. Покупку Кирилл ОТЛОЖИЛ
(«пока отложим») — без его «да» на имя и сумму не покупать.
Мост Telegram поэтому грузится со своего сайта (`public/vendor`,
`MiniAppChrome`): `telegram.org` не открывался с двух узлов из трёх.
**И обратная половина того же — сайт НЕ доходит, а трекер «работает»**
(21.10.2026, Макаров и Синецкий: «закрыл задачу, думал закрылась»).
Страница и чанки приходят из кэша воркера, задачи и чат — напрямую из
Supabase, а каждый запрос к `/api` кончается «Failed to fetch»: ответы,
приёмка, отметка «видел» и сверка версии не уходят, поэтому у Макарова
две недели был интерфейс начала октября и ни одного `seen_at`. В базе
ни одного его отчёта. Хуже самого отказа было то, что экран отмечал
«Сделал» заранее и при обрыве НЕ откатывался: `throw` из `fetch`
перепрыгивал строку перечитывания. Первая починка откатывала экран и при
обрыве; тем же днём его словами «надо чтоб трекер работал и накапливал
изменения… в режиме без интернета» это заменено на **очередь**
(`lib/outbox`): все кнопки ответа идут через `lib/postJson` →
`postOrQueue`, а фоновые `void fetch(...)` — через `queuePost`. Не дошло
(fetch бросил, 5xx, 401, 404) — запрос ложится в localStorage под своим
auth-id и уходит сам (сеть вернулась, возврат к окну, раз в 30 с, старт,
первый удачный `/api/version`), строго по порядку нажатий. Отказ по
существу (400/403/409) снимается из очереди и называется тостом. Экран НЕ
откатывается: `useTaskParticipants`/`useMeetingVotes` накладывают ждущие
ответы поверх прочитанного (`pendingPosts`) — иначе перечитывание при
живой базе и мёртвом сайте стирало бы их. Реплика в чате без связи — та же
очередь (`queueInsert`, id задаётся в браузере, повтор = «уже есть»),
пузырь подписан «ждёт сети»; с файлами — нет, файл надо загрузить.
`VersionWatch` после двух неудач `/api/version` подряд ставит
`setServerUnreachable`, и это значок облака в шапке с числом ждущих
(`#connOfflineBtn`), а не красная плашка поверх трекера. **Новая кнопка,
которая зовёт /api, — через `postJson`/`queuePost`, а не голым `fetch`**,
иначе без связи она снова теряет ответ молча; и если хук перечитывает
таблицу, которую этот ответ меняет, — наложите на неё очередь. Сторож —
`e2e/offlineQueue.spec.ts` и `postJson.test.ts`. Окно на старом коде
очереди не получит, пока хоть раз не откроется из сети, где сайт доходит.
Лечит причину только свой домен (см. выше).

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

**Окно закрывается только СВОИМ `cancel`.** 06.10.2026 (отзыв
Витовского): «нажимаю прикрепить файл, не важно Esc или отмена —
закрываются все окна в иерархии». Причин две, и обе не видны чтением:
поле выбора файла шлёт `cancel`, когда системное окно закрыли пустым, и
это событие ВСПЛЫВАЕТ до `<dialog>`; а React проносит синтетическое
событие по дереву КОМПОНЕНТОВ, так что Escape окна, открытого изнутри
другого окна, доходил до `onCancel` внешнего, хотя в документе они
соседи. `Modal` проверяет `event.target === event.currentTarget`;
любой свой обработчик `cancel`/`close` у окна обязан делать то же.

**Форма сохраняет запись целиком, а не то, что в ней есть.** `save()` в
`TaskModal`/`MeetingModal` собирал объект из полей формы — и терял всё,
чего в форме нет, в первую очередь `createdBy`. У руководителя это
превращало его задачу во «владельцеву»: карточка подписывалась «Кирилл →
Игорь», рядом вставала вторая, а синхронизация руководителя («пишу только
своё») переставала отправлять правку вовсе («нажимаешь Сохранить —
появляется дубль»). Теперь объект начинается с `...task`/`...meeting`.
Добавляя поле в тип, не надейтесь, что форма его донесёт, — она донесёт,
только пока стоит этот спред.

**Триггер и браузер заводят строки участия — значит, upsert, и у встреч
тоже.** Правило про задачи (ниже, «строку участия заводит либо триггер,
либо код») не было применено к `meeting_participants`: браузер вставлял
пачку «Кирилл + Нодберг», триггер 0024 уже завёл Нодберга, и база
отвергла пачку ЦЕЛИКОМ — встреча осталась с одной строкой из двух
(«ответили 0 из 1»), а Кирилл без приглашения. Вставка пачкой падает вся
из-за одной строки: ищите это первым, когда «пропал один человек».

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
`commentDelivery.ts`: участники итема плюс постановщик, минус автор. Порог
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
письма собирает сам Supabase, и пока Site URL проекта был localhost, любое его
письмо вело в никуда (Authentication → URL Configuration, чужая панель).
**07.10.2026 Кирилл поставил Site URL = https://task-tracker-beta-ebon.vercel.app**
— проверено: `generateLink` теперь отдаёт `redirect_to` на наш домен.
Собственная сборка ссылки ниже всё равно остаётся: она не зависит от чужой
панели, а панель могут поменять снова.
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

**«Тупит» — сначала замер, потом правка** (07.10.2026, его слова: «трекер
работает медленно, мессенджеры при нажатии любых кнопок тупят»). Два
скрипта отвечают числом, а не ощущением: `scripts/bot-latency.mjs [url]`
жмёт кнопки обоих ботов в выдуманных чатах, `scripts/route-latency.mjs
[url]` — маршруты трекера. Что они нашли и что из этого стало правилом:
*Прослойка сессии не трогает /api.* `auth.getUser()` в `supabase/middleware`
— запрос по сети — стоял первой строкой и оплачивался каждым нажатием в
мессенджере и каждым «Принял» в браузере, хотя каждый маршрут /api
проверяет вход сам. Новый маршрут /api обязан звать `getUser` сам или
стоять за своим секретом — прослойка его больше не прикрывает.
*Рассылка нескольким — параллельно* (`Promise.all`), а не `for … await`:
каждая отправка — полёт до Telegram или из Франкфурта до MAX в России.
*Экран меняется раньше сервера* и для ответов исполнителя
(`lib/answerPatch`), а успех не ждёт полного перечитывания — его приносит
подписка. *Перечитывания склеиваются* (`lib/coalesce`): одно «Принял» —
несколько событий подписки, и каждое запускало полное чтение участия
(было трижды за одно открытие). *Один экземпляр хука данных на экран*:
«Сегодня» держал свой `useTaskParticipants` — вторые запросы и вторая
подписка. *Холодный вебхук* (1,1–1,8 с против 0,3–0,5 с тёплого) будит крон
напоминаний пустым GET раз в пять минут.

**Пишем в ОДИН мессенджер — выбранный человеком, MAX по умолчанию**
(28.10.2026, его слова: «возможность выбрать только один бот,
приоритетный конечно МАХ, но и телеграмм должен быть доступен для
выбора»). Колонка `assignees.messenger` (миграция 0070, пусто = MAX),
у владельца — на его строке «(я)». `chatsFor` и `ownerChats` ставят
выбранный ПЕРВЫМ, второй остаётся запасным (подключён только он — пишем
в него), и все рассылки берут один чат — владельцу тоже, раньше он
получал всё дважды. Выборка строки человека для рассылки обязана просить
`messenger` (`PEOPLE_CHAT_COLUMNS`), иначе выбравший Telegram молча
получит MAX. Выбор — «Писать в» в «Личном кабинете», только когда
подключены оба; пишет `/api/account/messenger`.

**Один ответ — во всех мессенджерах сразу** (07.10.2026, «я хочу, чтобы
они работали абсолютно синхронно»). Каждое сообщение бота с кнопками
ответа о задаче или встрече запоминается в `bot_messages` (миграция 0044,
только служебный ключ) — передайте `memo` в `sendToPerson`, иначе
сообщение выпадет из синхронизации. После любого ответа (кнопка в любом
мессенджере, текст причины, ответ в трекере через `/api/workspace/report`)
`lib/botMirror.mirrorAnswer` переписывает все остальные сообщения человека
текстом `meetingCard`/`taskCard`; нажатое пропускается — его уже
переписал ответ на нажатие. Отменённая и перенесённая встреча снимает
кнопки у всех (`mirrorClosed`). Отказ от встречи в боте пишется в
обсуждение и организатору ТОЛЬКО вместе с причиной. Итог встречи,
закрытие без слов и перенос (`/api/workspace/meeting-moved`) оставляют
строку в обсуждении. Предложить другое время участник может репликой с
колонкой `item_comments.proposal`; «подходит / не подходит» — это 👍 / 👎
на неё, организатор переносит одним нажатием. События в прошлом не
заводятся нигде: `MiniCalendar minDate`, погашенные слоты, отказ в `save()`.
Лента обсуждения кэшируется по элементу и просится заранее при наведении
на карточку (`prefetchComments`), реакции читаются встроенными в ту же
выборку — до этого их запрос был без фильтра на всё пространство.

**Открытое окно обновляется само** (`VersionWatch.tsx` + `/api/version`,
07.10.2026). Вкладка, установленное приложение и окно на ПК живут на коде,
с которым их открыли: запрет встреч в прошлом был на сайте с 12:00, а в
12:13 встречу на 11:00 создали из утреннего окна, и Кирилл увидел «по-
прежнему позволяет»; на основном аккаунте не было и кнопок «Буду». Окно
сверяет номер версии (`NEXT_PUBLIC_RELEASE`) при возврате к нему и раз в
пять минут и перезагружается, когда не открыто ни одного `<dialog>` и
фокус не в поле. Окна, открытые ДО этого механизма, его не знают —
их однажды перезапускают руками. Проверяя выкладку на боевом, помните:
«не обновилось» у человека чаще всего значит старое окно, а не старый сайт.

**Лишние оповещения — тоже решение, и оно записано** (07.10.2026, «убери
лишние оповещения»). Убраны: окошко «Задача на сегодня» на каждую задачу
при первом открытии за день (и такие же уведомления браузера); второй
сигнал «встреча начинается»; предупреждение «десять минут до конца» всем
участникам (осталось «время вышло»); сводка организатору за два часа и за
сутки, когда решать нечего (`organizerNeedsReminder`). В MAX подсказка
после нажатия идёт уведомлением (`notification` в ответе на callback), а
не отдельной строкой в чате. Прежде чем добавить оповещение, ответьте, что
человек по нему СДЕЛАЕТ; если ничего — его не должно быть.

**Всплывающие уведомления на ПК — из обсуждений, и выключается только
второстепенное** (07.10.2026, его слова: «чтобы они возникали и вылазили
сверх открытых окон на ПК. И чтобы при нажатии на уведомление переходило в
конкретное окно встречи… обязательно должны всплывать любые новые сообщения
от коллег… и кнопочку „отключить уведомления“»). `hooks/useDesktopAlerts`
+ `lib/desktopAlerts` (что и какими словами, с тестами) + `lib/alertPrefs`
(что выключено). Источник событий — строки `item_comments` моих видимых
задач и встреч: реплики коллег там, а каждое действие и так пишет строку
хроники. Отдельной таблицы событий нет и не надо (третья правда). Новая
задача или встреча на мне — по появлению среди видимых, а не из хроники.
Что здесь легко сломать:
*Хроника знает автора* — `recordEvent({ actorUserId })` пишет
`author_user_id` у system-строки, иначе человеку всплывает его же «принял
работу». Строка от этого не становится его репликой (`mine` у system всегда
false — править её база не даёт). Пишете новую хронику из маршрута —
передайте `actorUserId: user.id`.
*Видимость — та же, что у экрана*: подписка одна и без фильтра, а владелец
по правам базы читает всё пространство, поэтому фильтр стоит в
`alertForComment` по списку видимого (и ВИДЕННОГО — отменённая встреча к
моменту строки «отменил» уже удалена).
*Перенос пишется в обе встречи* — окно одно, по новой; «вас позвали» по новой
встрече ждёт 20 с и молчит, если пришёл перенос.
*Не выключаются* реплики коллег, новая задача/встреча на мне, перенос и
отмена встречи; выключаются ход работы и «за 15 минут до встречи», есть
«тишина на час» и «не беспокоить» на одно обсуждение (кнопка в его шапке).
*Но есть общий выключатель* (15.10.2026, его слова: «чтобы… можно было
глобально включать или выключать уведомления», образец — плашка «Включите
уведомления» из корпоративного мессенджера): главный переключатель в
колокольчике (`enabled` в `alertPrefs`, через `isQuiet` глушит всё, реплики
коллег тоже). **Плашки под шапкой нет — он снял её тем же днём**:
«всплывающие окна мне не нравятся и засоряют место, размести все понятно и
аккуратно в нашем колокольчике». Поэтому колокольчик — не меню, а панель с
переключателями (`AlertsButton`, `#alertsPanel`): она не закрывается на
каждом нажатии, а положение переключателя и есть состояние. Выключенное
целиком видно по самому колокольчику (перечёркнут, тёплый цвет); строки
под главным переключателем при этом скрыты. «Разрешить» поверх всех окон —
строкой в той же панели, только пока браузер не спрашивали.
Хранится в браузере: это свойство компьютера, а мессенджер этим не
управляется — решение «никаких настроек уведомлений на человека» было про
бота и в силе.
*Нажатие поднимает окно настольного приложения* меткой `#rokas-raise`
(страница) → `did-navigate-in-page` (desktop/main.js): моста между ними нет
нарочно. Это нужно оболочке ≥ 1.0.9; там же `setAppUserModelId` (без него
Windows подписывает окно «electron.app…») и `backgroundThrottling: false`
(свёрнутое окно иначе засыпает). `smoke.mjs` проверяет подъём по метке.
*Перенос в мессенджер* — одно сообщение «было → стало» с кнопками по новой
встрече из `/api/workspace/meeting-moved`, после окна «Отменить»;
приглашение при переносе вкладка не шлёт (`inviteNewcomers(m, false)`),
иначе люди получали бы «Встреча от…» и читали её как вторую встречу.

**Четыре вещи 07.10.2026 со своими ловушками** (ответ Кирилла на
`docs/proposals-2026-10.md`, там же его слова).
*Сводки — по понедельникам и средам* (`lib/briefDays`) и смотрят вперёд до
следующей, иначе срок во вторник не попал бы ни в одну. Уходит сводка
только при горящем сроке (просрочено, сегодня, скоро — 28.10.2026), а вид
у неё «карточки» (`composeManagerBrief`): раздел капсом с числом и чертой,
задача строкой, срок отдельной строкой под ней. Выбран им из трёх вариантов,
присланных ТОЛЬКО ему — пробные варианты сообщений команде не шлются.
*Номер задачи ставит база* (миграция 0045, счётчик на пространство).
Триггер обязан пропускать upsert СУЩЕСТВУЮЩЕЙ строки: BEFORE INSERT
срабатывает и у upsert'а, который кончится обновлением, а синхронизация
пишет только так — без проверки каждая правка срока сжигала бы номер.
Номер в браузере появляется эхом строки; серверу, который шлёт сообщение
сразу после вставки, его отдаёт `.insert().select("number")`.
*Регулярная встреча — цепочка отдельных встреч* (миграция 0046,
`lib/meetingRepeat`), следующую заводит крон напоминаний в день текущей.
Два прогона крона не заводят двух планёрок, потому что `recur_next_id`
сперва ЗАНИМАЕТСЯ условным UPDATE, а вставка идёт после. Перенесённая
(с `moved_to_date`) цепочку не продолжает — её несёт новая; поэтому и
`reschedule`, и перенос формой передают `recur` явно. Подписи —
в `meetingRepeatLabels`: основной модуль тянет серверную рассылку, и
импорт его в форму утащил бы её в браузер.
*Отсутствие — на строке человека* (миграция 0047, `lib/away`), пишет
маршрут `/api/workspace/away` (себя — каждый, другого — владелец). Это
знание, а не запрет: поручить уходящему в отпуск можно. Ступени просрочки
и «не взял задачу» его не будят. Все три миграции применены ДО кода —
синхронизация и выборки обращаются к новым колонкам и без них отвечают
ошибкой.

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

**Личный кабинет заводится сам — из привязанного мессенджера** (13.10.2026,
его слова: «улучши систему подключения новых пользователей и внедри
полноценную работу личных кабинетов»). До этого вход был у семи человек из
пятнадцати: приглашение, почта, пароль и отдельная вторая ссылка на бота
терялись на каждом шаге. Теперь доказательство личности одно — чат,
привязанный к строке человека кодом, который выдал Кирилл (или сам человек
из своего кабинета). Кто открывает мини-приложение или пишет «вход» из
такого чата, получает кабинет на служебной почте `kabinet-<id>@rokas.invalid`
(`lib/cabinet.ensureCabinet`); свою почту и пароль для компьютера он задаёт
в окне «Личный кабинет» (`AccountModal`, маршрут `/api/account/credentials`).
Граница не двигается: `disabled` кабинет не возвращает НИКАКОЙ путь. Здесь
же найдена дыра: «вход» в боте проверял статус `revoked`, которого в базе
нет, — отключённый человек получал ссылку входа. Окно «Личный кабинет»
открывается своим именем в шапке (на телефоне — первая строка меню) и
собирает о себе всё: роль, вход с компьютера, мессенджеры (той же плашкой
`MessengerLink` с `embedded`), «меня не будет», календарь, выход.
*Код подключения мессенджера выписывается заранее* (`useMyMessenger.prepared`,
в браузере на двое суток), и «Подключить» — обычная ссылка: у Нодберга
запрос за кодом в момент нажатия дважды не дошёл до сервера.
*Бот приветствует подключившегося меню* с «📱 Мобильное приложение» —
подключение и есть вход, второго шага нет.

**Приглашение — одна ссылка, вход на ПК — через бота** (28.10.2026, его
слова: «самый современный и простой способ отправлять приглашения, скачивать
людям десктопное приложение и присоединяться к ботам»). Раньше человеку
слали три ссылки (Telegram, MAX, «в трекер» с паролем), и Кирилл выбирал за
него мессенджер. Теперь «Пригласить» в «Команде» (и «Пригласить всех» —
одним запросом `/api/workspace/welcome`) даёт ссылку `/welcome/<код>` и
готовое сообщение с именем: страница показывает имя, кнопки обоих ботов
(код канала `any` в `telegram_link_codes` — его принимают оба бота и он
НЕ сгорает при подключении; перепривязать уже подключённого к ЧУЖОМУ чату
`handleLinkCode` отказывается), «телефон — кнопка в боте» и установщик
(`/api/download` — постоянная ссылка на `.exe` последнего выпуска через
API GitHub). Ключевое — **вход на компьютере**: кабинет из мессенджера живёт
на служебной почте, и в настольном приложении человек упирался в форму
пароля, а ссылка «💻 Вход с компьютера» из бота открывалась в системном
браузере, а не в окне приложения. Теперь на `/login` первыми стоят «Войти
через Telegram / MAX» (`MessengerSignIn`): окно заводит `login_requests`
(миграция 0069, только служебный ключ), ссылка ведёт в бота с токеном
`LOGIN…`, бот спрашивает «это вы?» (`t:lgok`/`t:lgno` — без вопроса
чужая ссылка с токеном отдала бы вход тому, кто её прислал), кладёт код
magiclink, а окно, опрашивающее раз в 2 с, забирает его ОДИН раз и входит
у себя. Сторож — `e2e/welcome.spec.ts`.
«Команда» при этом: отбор «Все · На связи · Не подключены · Нет на месте»,
поиск (ПК, больше восьми людей), карточка человека по нажатию на имя —
факты связи и входа и те же действия, что в ⋮ (один список
`menuItemsFor`). О работе людей в ней по-прежнему ничего. Кабинет:
уведомления этого устройства — те же переключатели, что в колокольчике
(`AlertSettings`, один компонент), приложение для Windows, «Выйти на всех
устройствах». **Обычный «Выйти» выходит только здесь** (`scope: "local"`):
по умолчанию Supabase выходит везде, и выход на рабочем ПК закрывал трекер
и на телефоне.
**«Мои данные» — второй этап, не часть подключения** (тем же днём: «всем
внести свою почту рабочую, телефон и поставить свой пароль… если не при
регистрации, так потом, вторым этапом»). Раздел первым в кабинете; поля
сохраняются по отдельности (`/api/account/credentials`). Телефон —
`assignees.phone` (миграция 0071) в одном виде (`lib/phone`), и в
браузер он НЕ открыт: столбцу нарочно не выдан grant (0057 выдаёт чтение
людей по столбцам) — номер видят сам человек и владелец в карточке
«Команды» (`/api/workspace/contacts`, там же рабочая почта). Пока почты
или телефона нет — точка на имени в шапке (`useProfileStatus`,
`#profileDot`); пришедшему через бота (почты нет вовсе) кабинет один раз
на устройстве открывается сам. Плашки поверх доски нет — их он снимал.
**Стартовое знакомство новым людям** (тем же днём: «стартовое обучение
возможностям… или систему подсказок… внедри»). Окно с карточками
(`WelcomeTour`, слова и правило — `lib/welcomeTour`), а не подсветка
кнопок: раскладка разная на ПК, в сжатом окне и на телефоне, и стрелка
«вот эта кнопка» смотрела бы в пустоту. Само всплывает КАЖДОМУ один раз на
версию знакомства (тем же днём: «сделай всем при следующем открытии
знакомство… чтобы все прошли его»; сперва было только новым, моложе 30
дней): отметка `tour_version` в метаданных учётной записи, решает
`getUser`, а не сессия — в токене сессии на втором устройстве до часа
лежит старое «не видел». Заметно дополнили знакомство — поднимите
`TOUR_VERSION`, и его снова увидят все; автотестам
(`navigator.webdriver`) — нет. Пункты карточек — «кнопка — что
делает» словами экрана; телефон только у владельца, не пишите «коллеги
позвонят». Снова открыть — «Как пользоваться
трекером» в кабинете и в меню телефона. Последняя карточка ведёт в «Мои
данные»; пока знакомство открыто, самооткрытие кабинета ждёт. Новая
крупная возможность — допишите шаг в `tourSteps`.

**Меню бота — оба пути сразу** (13.10.2026: «меню в ботах должно предлагать
оба варианта — и „меню кнопок“, и „мобильное приложение“»). Первая строка
меню у всех — «📱 Мобильное приложение», ниже разделы, внизу «💻 Вход с
компьютера». Синяя кнопка у поля ввода в Telegram снова список команд
(первые — «☰ Меню кнопок» и «📱 Мобильное приложение»); поимённая кнопка
web_app с 20.09 снята, потому что прятала кнопочное меню. В MAX кнопка
приложения — `open_app` с `web_app: <имя бота>`, а не ссылка: ссылка
уводила во внешний браузер без подписи, на форму входа. Формат проверен
запросом к API (на адрес вместо имени MAX отвечает «Link not found»).
Список команд MAX через `PATCH /me` больше не ставится (13.10.2026 — 404):
в MAX подсказка по «/» прежняя, а слова «приложение» и «вход» работают.

**Мини-приложение MAX на КОМПЬЮТЕРЕ живёт в чужой рамке** (`<iframe>` на
`*.max.ru`/`*.oneme.ru` — так написано в самом мосте MAX), а сайт отдавал
`frame-ancestors 'none'` и `X-Frame-Options: DENY`: белое окно, которое не
загружается никогда (снимок Кирилла 13.10.2026). Разрешено его словами
«разрешаю показ в окне MAX»: `frame-ancestors` пускает `*.max.ru`,
`*.oneme.ru` и Telegram Web, XFO убран. Это две правки, которые живут ТОЛЬКО
вместе: куки входа теперь `SameSite=None; Secure` (`supabase/cookieOptions`,
одно место на браузер, сервер и прослойку) — Lax в чужой рамке браузер не
хранит, и вход уводил на /login. А раз кука уходит и на запрос с чужого
сайта, преграда теперь — проверка Origin для записей в `/api`
(`crossSiteWrite` в `supabase/middleware`, тест `crossSite.test.ts`).
Новый маршрут, принимающий запись без сессии, проверку проходит, только
если не шлёт Origin (вебхуки, крон); не убирайте её «для удобства».
Safari рамкам третьей стороны куки не даёт вовсе — там остаются «💻 Вход с
компьютера» и настольное приложение.
Заодно починено то, что работало на телефоне вполсилы: в MAX
грузился мост Telegram (MAX `ready()` не получал), и оба моста запрещала
CSP — теперь `script-src` их разрешает, а `MiniAppChrome` грузит мост
своего мессенджера. Вход ставит сессию сервер (`lib/miniAppRoute`), а
повторное открытие тем же человеком новую сессию не выписывает.

**Обсуждение — как в Telegram** (13.10.2026, «со всеми правилами,
реакциями, возможностью добавлять смайлики»): смайлики у поля
(`EmojiPicker`, недавние в браузере), «вниз» с числом новых — лента больше
не прыгает вниз, пока человек читает выше; двойное нажатие — 👍; ↑ в пустом
поле — правка своего последнего; ссылки нажимаются (`lib/chatText`). Набор
РЕАКЦИЙ остался фиксированным (миграция 0040) — реакция уезжает в
мессенджер строкой.

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
**И та же ошибка в обратную сторону — НАЖАТИЕ и ОТВЕТ, 06.10.2026.**
Руководитель позвал Кирилла на встречу, приглашение дошло, а каждая
кнопка под ним отвечала «Эта кнопка не для вас»: получательская половина
бота искала нажавшего по чату в строке людей, а у владельца чат в
учётной записи. Теперь `findOwnerSelfByChat` находит его строку «(я)», а
его текст после «Сделал / Не смогу» два часа считается ответом, а не
поручением (`answerOwnOpenQuestion`). В тот же день нашлись ещё две
формы той же ошибки. `/api/telegram/send` выходил из цикла на первом
удачном мессенджере, и в MAX владелец не получал ничего. Крон слал
«время вышло», «что решили?» и сводку ответов владельцу пространства, а
не тому, кто собрал встречу: Кирилл получал их по чужим встречам, а
организатор не получал вовсе. Организатор — это `created_by`
(`tellOrganizer`), владелец — только когда поле пустое. **«Владелец
пространства» не значит «тот, кому это адресовано» — ни для отправки, ни
для нажатия.**

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

**Запрос Supabase уходит в сеть на КАЖДЫЙ `.then`** — построитель ленив,
это не обещание. Ждать его дважды (`Promise.resolve(q)` в одном месте и
`await q` в другом) значит послать его дважды: 08.10.2026 одно нажатие
Enter в повестке писало пункт двумя строками через 10 мс. Если результат
нужен двоим, сначала `const p = Promise.resolve(q)`, и оба ждут `p`. И
проверяйте в тестах «ровно одна строка», а не `limit(1)` — второе отвечает
«хотя бы одна» и дубль не видит.

**Кнопка, которая ЗАВОДИТ, срабатывает один раз — по ref, а не по
состоянию** (15.10.2026). В базе нашлись близнецы двух видов. «Поискать
БАЗЫ клиентов!» 21.09 — две строки с разными id через 41 мс: окно новой
задачи прошло `save()` дважды, а каждый проход зовёт `uid()`. Защита
`if (saving)` читала состояние из замыкания, и второе нажатие, пришедшее
раньше перерисовки (дребезг кнопки, двойной тап в мессенджере), видело
прежнее «не сохраняю». Теперь `committedRef` в `TaskModal`/`MeetingModal`
и `firstConfirm()` в `QuickAdd`; сторож — `e2e/doubleSave.spec.ts` (два
`click()` в одном задании браузера; на старом коде давал две задачи и две
встречи). Второй вид — «тестовая задача для закрытия» 14.09: модель на
одну фразу вернула `create_task` дважды (по разу на каждое имя), и код
завёл обе. `mergeDuplicateItems` в `parseQuickAdd` сливает одну вещь,
названную дважды, — второй человек становится соисполнителем. Новая
кнопка, которая создаёт запись с новым id, обязана нести такой же флаг.

**Меню меряет себя только в открытом слое.** `PopLayer` открывает слой в
`useLayoutEffect`: пока слой не открыт, `popover` держит его
`display:none`, и меню, которое ставит себя у края экрана по своей высоте,
меряет ноль и не переворачивается вверх (окно дня в календаре открывалось
за нижним краем). Не возвращайте туда `useEffect`.

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

**«Загрузки» нет — ни кнопки, ни окна, ни раздела «👥 Люди» в боте**
(21.10.2026, его слова: «ты меня поставил и она видна и работает у всех
пользователей оказывается, а я всем говорю что инфа конфиденциальна и за
вами никто следить не будет… задача снимать чужую загрузку снимается»).
Окно «у кого сколько в работе, просрочено, без ответа» — это сводка о
людях, а сводка о людях противоречит концепции равноправия и
конфиденциальности (см. начало файла) независимо от того, что именно она
считает: человек читает её как «за мной следят». Удалены `LoadModal`,
`lib/peoplePanel`, пилюля над доской, строка в меню телефона, фильтр
доски по исполнителю (он жил только в этом окне), а в боте —
«👥 Люди», `peopleLoadReply`, карточка человека (`oper`) и тема справки.
Старая кнопка «👥 Люди» в уже присланном сообщении открывает общий список
своих задач. **Не возвращайте её ни в каком виде** — ни «только числом»,
ни «только тем, что я поручил». Кому поручить, решают разговором, а
занятость времени для встречи по-прежнему видна (`busy_slots`). Порядок
полосы над доской: «Я поручил · Мне · Помогаю · Личные», «Завершённые»; «Просрочено» и «Отложено» на ПК — в шапке слева от лупы (22.10.2026).
Заголовки столбцов — по центру.

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
только показывают («Завершённые»), щелчок мимо остаётся —
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
встречи дата, время и состав не редактируются: их показывает
сводка (`.meeting-facts`), полей нет вовсе, и `save()` берёт эти три
значения из самой встречи, а не из состояния формы — чтобы одна будущая
кнопка не отменила запрет молча. Причина не в аккуратности: о встрече уже
сообщили всем, кого она касается, и по ней уже проголосовали, а тихая правка
времени у себя в окне не меняет ни того, ни другого — она разводит то, что
люди видели, и то, что записано. Слова Кирилла: «в моменте не подлежит
изменению, изменения и дополнения участниками возможны только при дальнейшем
переносе». Меняется это переносом, и это ОДНА форма — НОВОЙ встречи с тем
же составом, длительностью и повесткой, где можно поправить и время, и кого
зовём (`openMoveForm` в `MeetingsPanel`). Ведут в неё и кнопка в самой
встрече, и «Перенос» на карточке в списке (23.10.2026: «сделать полноценное
окно переноса как в большой кнопке… с возможностью менять состав участников
или дополнять его» — до этого из списка спрашивались только дата и время).
Время в ней — прежнее или следующее свободное (`rescheduleTime`). Escape из
формы, открытой во встрече, возвращает во встречу, из списка — закрывает.
Окно «дата и время» осталось только перетаскиванию на день календаря. Все
пути закрывают прежнюю встречу одной функцией `closeAsMoved` — «перенесено» это четыре поля разом плюс отмена, и
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
*Справочники тоже* (22.10.2026: у мыслей при открытии была одна «Создать»,
а «Отправить / Поделиться» вставали через секунду — ждали список команды).
`createSharedStore(…, persist)` кладёт последний ответ в localStorage под
своим auth-id и отдаёт его первым кадром; так живут команда, авторы,
убранные, разделы и бот MAX. Новый справочник, который виден сразу, —
с `persist`. Сторож — перезагрузка с задержанным запросом в
`e2e/ideaActions.spec.ts`.
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
*Подписка не фильтруется по `user_id`* (14.10.2026). Фильтр был
`user_id=eq.<мой id>`, а у строк пространства `user_id` — id ВЛАДЕЛЬЦА: у
всех, кроме Кирилла, подписка на задачи, встречи, мысли, людей и разделы
не срабатывала НИКОГДА, и «Сделал» коллеги доезжал минутным догоном или
по F5. Владелец этого не мог увидеть — у него свой id и есть id
пространства. Подписка, как и загрузка, читает «что разрешают права».
Подписывается она и в режиме `/sb`: websocket идёт мимо прокси, а режим
включается от одной неудачной выборки. Догон срабатывает и на `focus`
окна (два окна рядом оба «видимы»). Сколько идёт эхо до другой стороны —
`scripts/realtime-latency.mjs` (норма ~0,5 с); если «тупит», сперва он.
*Возврат и приёмка меняют экран до ответа сервера*: колонку приёмки
вкладка ставит у себя сама, ответы снимает сразу, а «ответили все» у
возвращённой задачи считается новой сдачей (`columnOf`, `taskStage`).
Повторный возврат без нового отчёта запрещён и в карточке, и в
`applyReview`. Рассылка из `/api/workspace/review` идёт через `after()`.
А строка с несохранённой правкой всё равно берёт с сервера колонки,
которых браузер не пишет (`withServerFields`).

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
равен моему auth-id; у владельца своё — строки с пустым `created_by`, и
только они (с 06.10.2026 — см. «Владелец — один из равных» ниже).
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
**И в сводке одна строка на человека по одной задаче** (14.10.2026, снимок
Кирилла: «не может выполнить» и ниже «написали в обсуждении» — тот же
человек, та же задача, дважды; «бред»). `foldNotices` в `noticeQueue`:
ответы одной семьи схлопываются в последний («не могу» кнопкой + причина
текстом = одна строка с причиной, «принял» → «не могу» = «не могу»), а
реплика того же человека по тому же делу приклеивается к ответу строкой
«💬 …» и пропадает, если повторяет его слова. Склеивает по `item_id`
(миграция 0054) — передавайте `itemId` и `num` в `notice`, иначе строка
склеится только по названию. **Номер задачи — во всех сообщениях бота**
(«для ориентира», его слова): `lib/taskRef` даёт «#12 «Смета»» для текста и
«#12 Смета» для кнопки и строки списка; новое сообщение о задаче пишите
через него, а не `«${title}»`.
**Реплика из обсуждения уходит постановщику, а не «владельцу всегда»**
(`commentDelivery`, 14.10.2026). Владелец получает её, только если он сам
поручил или стоит на деле: видимость одна для экрана и для бота, и сводка с
чужими переписками была той же лентой.

**Владельческой утренней сводки нет** (28.10.2026, его слова: «это
ежедневное оповещение убери вообще у всех, оно только эфир засоряет»).
«☀️ Утро. Главное на сегодня» с приёмкой, молчащими, неподключёнными,
сроками поручений и обсуждениями удалена вместе с `dailyBrief`,
`silence`, `pendingInvites`. Осталась одна утренняя сводка —
`managerBrief` «Доброе утро» каждому про СВОИ дела, владельцу тоже. В ней
личная задача (`selfTaskServer`) — только сроками: просрочено, сегодня,
скоро; без «ждут вашего ответа», возврата, напарников и обсуждений («по
ним напоминать в ботах не надо»). Убранные из команды (`archived_at`) в
неё не попадают ни адресатом, ни напарником. Не возвращайте владельческую
сводку «короче» или «раз в неделю» — просьба была убрать.
**«(я)» в мессенджер не уходит никогда** — `lib/botText.stripSelfMarks`
на выходе в `telegram.ts` и `max.ts` (текст, кнопки, всплывашки). Он
просил убрать его трижды: каждый раз оно возвращалось новым сообщением,
собранным из имени строки напрямую. Новый способ отправки в мессенджер —
только через эти два файла.

**Заведённая задача — не черновик.** У неё нет полей: название заголовком,
описание текстом, из правки только срок (его двигает постановщик), состав,
приёмка и обсуждение. Причина та же, что у назначенной встречи: задачу уже
отправили человеку, он её принял и по ней отчитывается, а правка названия
или приоритета в этот момент разводит то, что записано, и то, что он видел.
Полная форма — только у новой задачи. Приёмка закрывает окно: задача уходит
в «Завершённые», и окно, висящее над закрытой задачей, — это вопрос «а что,
не сработало?». Возврат на доработку закрывает его тоже.
**Название — исключение с 28.10.2026** (его слова: «удобно редактировать
название задачи, в канбане нажав на поле, а в открытой задаче сделай
удобный значок… понятный»). Постановщик открытой задачи правит его на
доске нажатием на название (`TaskCard onRename`, только ПК — на телефоне
нажатие открывает карточку) и кнопкой «✎ Изменить» в рамке шапки
(`ItemModalHead onRename`, `#renameTitleBtn`). Enter и щелчок мимо
сохраняют, Escape отменяет только правку — и на доске гасит пробел/Enter
до dnd-kit, иначе набранное слово уносило бы кубик клавиатурой. Следствие
для e2e: открывать задачу с доски — `click(CARD_CORNER)` из
`e2e/helpers.ts`, а не нажатием по `.task-title` (у постановщика это
теперь правка). Сторож — `e2e/titleEdit.spec.ts`.
**То же у встречи** (28.10.2026, «сделай аналогично и во встречах»):
организатор незакрытой встречи правит название нажатием в списке
(`MeetingChip onRename`) и тем же «✎ Изменить» в окне; дата, время и
состав по-прежнему меняются только переносом. Поле одно на все четыре
места — `TitleEditField`; у карточки встречи есть `data-id`, а открывают
её в e2e тоже `click(CARD_CORNER)`. Окно встречи сохраняет итог и «Больше
не повторять» снимком `meeting` — поэтому в каждый такой `onSave` идёт
текущее `title` формы, иначе правка названия откатывалась бы следующим
сохранением.

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
**Документ прикладывается к ЛЮБОМУ ответу, не только к отчёту.**
06.10.2026: «возможность вложить документ должна быть при любом описании
завершения задачи, встрече, переносе и так далее». Кнопка одна —
`AttachFiles.tsx`, её ставят `AnswerForm` (по умолчанию у всех форм ответа)
и окно вопроса через `ask.askWithFiles`. Колонка своя только у отчёта; у
отказа, переноса, «не смогу», итога встречи, приёмки, возврата, волевого
закрытия и открытия заново документы ложатся в ОБСУЖДЕНИЕ элемента
сообщением «Документы к …» от имени ответившего (`lib/answerFiles`) —
туда же, куда уже пишется строка хроники об этом решении. Порядок тот же,
что у отчёта: файлы в корзину, потом ответ, потом сообщение — не
загрузилось, ответ не уходит. Добавляя новое место, где пишут результат,
спрашивайте его через `askWithFiles` / `AnswerForm` и оборачивайте
действие в `answerWithFiles`: кнопка без этой обёртки молча теряет файлы.

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
нижняя панель — **Встречи · Задачи · В работе · Приёмка · Мысли** (порядок
повторяет расположение блоков на компьютере; «Сегодня» убран 14.10.2026 его
словами, и листают разделы свайпом ТОЛЬКО по самой панели, не по
содержимому — там горизонталь у карточки), сессия начинается с «Задач»
(`DEFAULT_MOBILE_TAB`); в шапке ОДНА кнопка со значком людей, поиск — первой
строкой в её меню; «+» в разделе ОДИН и стоит сверху — круглой плавающей
«+» больше нет (16.10.2026, «оставить только один плюсик сверху»; у
встреч ради этого своя строка с «+»); в полосе над доской только «+»,
«Я поручил · Мне · Помогаю» (те же кнопки и та же логика, что на ПК,
вернулись 16.10.2026) и «Просрочено»; нижняя панель делится на столько
колонок, сколько в ней разделов (`grid-auto-flow:column`), — цифра
`repeat(6, …)` пережила убранное «Сегодня» и оставила справа дырку; завершённого на телефоне нет нигде —
ни столбца, ни галочек с числом в панелях («это большая информационная
нагрузка на восприятие»); ни календаря во встречах, ни заголовков, которые
повторяют подпись вкладки. Каждое из этих «нет» — отдельная его фраза, и
каждое возвращается одной случайной правкой, которая больше нигде себя не
проявит, поэтому все они проверяются тестом «на телефоне убрано всё, что
дублирует подпись вкладки».

**Телефон, 14.10.2026 — ещё семь «нет» и одна ловушка.** Его снимки с
iPhone: на телефоне нет поиска людей и «+ человек» (только список целиком),
нигде нет строк-пояснений «нажмите… и выберите…», в новой задаче нет поля
«Раздел» (раздел ставит кнопка над доской), подсказки в полях — одним
словом. Окна не ездят вбок: `.overlay` держит `overflow-x:hidden`, потому что
`overflow-y:auto` сам по себе делает auto и горизонталь. Стрелка назад —
`position:fixed`, и ради этого у полноэкранного окна снят `backdrop-filter`:
он делает элемент точкой отсчёта для fixed-потомков, и стрелка уезжала с
содержимым (поймал e2e). Чат — строка Telegram (скрепка · поле со смайликом ·
микрофон · ➤), лента открыта и пустой. Принятая разовая задача закрыта, даже
если `status` у неё не `done` (`isClosed` в `taskDisplay`): у задач,
принятых до 20.09, он так и остался `in_progress`. Сторож всего этого —
последний тест в `e2e/mobile.spec.ts`.

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
передаётся ПУСТЫМ для владельца, и пустое означает «автор не записан»: у
всего, что он завёл, `created_by` пуст — колонка появилась вместе с
многопользовательской частью и его собственные строки не помечает. Строгое
сравнение с его настоящим id однажды объявило чужой всю его работу, и он на
полчаса перестал мочь закрыть собственную задачу. Правило было написано в
четырёх местах чуть по-разному — и сломалось именно поэтому.

**Владелец — один из равных** (06.10.2026, его слова: «у меня не должно
быть преимуществ и привилегий, у всех равные права!»). До этого пустое «я»
значило «всё пространство моё», и в задаче, которую ему поставил коллега,
он видел «Удалить», «+ добавить», «Закрыть волевым решением», а в боте
принимал и закрывал чужое. Теперь распоряжается работой только её
постановщик, владелец тоже, и граница стоит во всех местах сразу:
`isMine`, синхронизация (`mine` в persistAll), маршруты
`participant-note`/`recap`/приёмка по встрече, бот (`authorFilter` рядом с
каждым `actorScope`, плюс «закрой/удали/перенеси», «что сегодня», поиск —
там своё и то, где он участник) и база — миграция 0043. **Её применяют
вместе со слиянием в main**, не раньше: иначе старый интерфейс на сайте
показывает кнопки, которые база молча отвергает. За владельцем осталось
администрирование — «Команда» и справочники; работа других людей — нет.
Добавляя новое действие над задачей, встречей или мыслью, проверяйте
авторство так же, а не «принадлежит пространству».

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

**Месячный и годовой повтор умеют «только в рабочий день»** (15.10.2026,
предложение Котова: «ставишь на 1-е, а оно выпало на воскресенье — задача
встанет на 2-е»). Колонка `recur_workday` (миграция 0064), расчёт один —
`lib/recurShift`, его зовут и доска (`taskDisplay`), и крон (`taskLogic`).
Выходные — сб, вс и неподвижные праздники РФ; ежегодные переносы
правительства НЕ учтены нарочно: точный календарь (`workCalendar`) — сетевой
запрос, а этот расчёт синхронный. Перенос может уйти в следующий месяц
(31-е в субботу → 2-е), поэтому `monthlyHits` спрашивает и прошлый месяц.
Новая серверная выборка, которая решает «пора ли повтору», обязана просить
`recur_workday` — без неё задача молча сработает в воскресенье.

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
*Занятость — запрет, а не пометка* (07.10.2026, его слова: «даёт создать
несколько встреч на одно и то же время с одним и тем же участником,
запрети»). Было «помечено, а не запрещено — поверх другой иногда ставят
осознанно», и итогом стали две встречи на 16:00 с одним человеком.
Правило одно — `busyPeople()` в `lib/meetingTime`, — и спрашивают его ВСЕ
двери, которыми встреча получает время: форма новой встречи и переноса,
«Перенос» на карточке, перетаскивание на день календаря, согласие на время,
предложенное участником, — и в боте: надиктованная встреча и кнопка
«перенести на предложенное» (`busyOnServer` в `lib/meetingBusyServer`
читает встречи дня из базы; отказ чтения — отказ назначить, а не «все
свободны»). Новую дверь без него не открывайте: запрет,
который обходится перетаскиванием, не запрет. Считается весь отрезок
(час в 15:30 заходит на чужие 16:00, и «1 час» гаснет), занятое
красное и зачёркнутое, не нажимается, а `save()` отказывает, если
человека позвали уже после выбора времени. Переносимая встреча сама себе
время не занимает. Гаснут слоты ТОЛЬКО у приглашённых: при
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
  **И индекс тоже общий.** `git add свой-файл && git commit` коммитит ВЕСЬ
  индекс, а в нём может лежать то, что соседняя сессия застейджила
  секунду назад. 07.10.2026 так в коммит с одной строкой CLAUDE.md уехали
  одиннадцать чужих файлов, причём частью кусков, — `main` перестал
  собираться. Коммитьте с путями: `git commit -m … -- путь1 путь2`
  (коммитит только их, чужой индекс не трогает), и перед пушем смотрите
  `git show --stat HEAD`.
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
**А дальше «Новых» своя задача идёт облегчённой дорогой** (07.10.2026,
его слова: «не нужны функции подтверждения, выполнения, не могу… колонка
„на приёмке“ получается тоже не нужна»). Своя = поставил я и РАБОТАЮ по
ней только я (`lib/selfTask.isSelfTask`, серверная копия —
`selfTaskServer`): второй исполнитель или соисполнитель делает её
обычной, а наблюдатели — нет (23.10.2026, его вопрос «почему не
применился функционал личной задачи?» про задачу на себя с
наблюдателем: наблюдатель не отвечает и не принимает, приёмка при нём —
тот же разговор с самим собой). У неё нет «На приёмке» (`columnOf(…,
self)`, перенос дальше «В работе» = закрыть), в карточке нет ответов,
приёмки и волевого закрытия — только срок, который двигается прямо там.
Флаг считается в ТРЁХ местах из одного правила: `TasksPanel`,
`NewTracker` (счётчики вкладок и «Приёмка») и `TaskModal`. Подробно —
`docs/how-it-works.md`, «Задача самому себе».

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
исполнитель или соисполнитель, — краснеет РАМКОЙ: работа на мне
(заливкой — до 21.10.2026, снята его словами «давай уберём красную
заливку»: она перебивала вид задачи).
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
нажатия),
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
Признак — ИСХОД, а не текст итога (16.10.2026): набранный в поле итог без
«Успех / Провал» встречу не закрывает, и такая встреча тоже «Нужен итог» —
красной рамкой, как просроченная задача, и с вопросом бота организатору.

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

**Замена текста скриптом молча промахивается мимо файла с CRLF.** Часть
файлов в рабочей копии с концами строк Windows (`file` пишет «with CRLF»),
и многострочный образец с `
` в них не находится — `String.replace`
просто ничего не меняет, без ошибки. 06.10.2026 так тихо не доехали
автозапуск в `desktop/main.js` и поиск в «+ добавить»; поймал это
только линтер («defined but never used»). Скрипт правки обязан бросать
на ненайденном образце и нормализовать `
` перед заменой (и
возвращать как было), а для одиночных правок — инструмент Edit.

**Windows/Git Bash:** heredocs eat backslashes, so a patch script written
with `cat <<'EOF'` mangles `\n` and regexes — use the Write/Edit tools for
anything containing a backslash. `next build` fails on `.next` files locked
by a running `next start` (and by OneDrive) — stop the server first.

**Кубик красит ОТНОШЕНИЕ задачи ко мне, а не мою роль** (13.10.2026,
`lib/taskCardKind`). Его слова: поручения другим — «основным фирменным
стилем», свои личные — «выразительная, но спокойная» отметка, поручение
мне — «свой отличительный приятный дизайн», соисполнитель и наблюдатель —
«менее выраженно… значок глаза». До этого фирменная заливка шла
ИСПОЛНИТЕЛЮ — то есть в первую очередь задачам самому себе, а поручения,
ради которых трекер заведён, стояли серыми. Видов пять, и вторым
кругом 14.10.2026 он их поправил («заливка напрягает», «лаванда не
нравится»): заливка только у `outgoing` (фирменная); `self` — жирная
тёплая полоса и «Личная задача»; `incoming` — фирменная рамка без
заливки; `co` — жирная фирменная полоса и «Помогаю»; `watch` — цветной
глаз и «Наблюдаю». Третьим кругом 15.10.2026: `self` — мягкий зелёный
(шалфей, не `--success`), `incoming` — мягкий пыльно-розовый красный (не
`--high`: тот значит «горит»; встреча, куда позвали, — тем же), `watch` —
серые полоса и надпись. Метки — в правом нижнем углу. Над доской — три
кнопки-фильтра «Я поручил · Мне · Помогаю» (с 22.10.2026 и «Личные» — задачи самому себе, `isSelfTask`), которые складываются
(`lib/boardFilter`), и все фильтры доски запоминаются на вход
(`useSavedSetting`). Срок по-прежнему сильнее: своё горящее краснеет рамкой (без заливки
с 21.10.2026), моё поручение другому — только корешком. «Скоро срок»
(завтра и ближайшие рабочие дни) — не жёлтой пилюлей, а оранжевым
стикером сразу справа от даты (`.task-soon-sticker`), пилюля при этом обычная; у
`incoming` (21.10.2026, «более выделялись задачи, поручены мне») —
рамка 2px со свечением, жирный корешок и метка «Мне поручено». Прежнее правило «авторство цветом НЕ
показывается» (ниже, «Роль — это КОРЕШОК») отменено им же. Сторож —
`e2e/roles.spec.ts` (вычисленные цвета пяти видов) и `taskCardLook.test.ts`.
Кубик теперь: номер слева вверху, название в рамке, галочка справа; ниже
«кто → кому» кружками (`PersonBadge`: зелёная галочка — взял, клетчатый
флаг фирменным голубым — закончил, пунктир — не приступал); внизу срок
пилюлей словами (`lib/dueLabel`: «до 19 окт · 6 дн.»). «0/6», «↗ поручили
вы» и «ждёт приёмки» убраны по его слову. Длинное название — своим окном
по наведению (`.task-peek`), не системным `title`.
*Флаг «закончил» — значок `finish`, а не `flag`* (14.10.2026): контурный
флажок в углу кружка размером 9 px читался буквой «Р», а золото —
оранжевым («хочется видеть не оранжевого цвета, а фирменного»). Клетки
залиты — единственное исключение из «только контур» в `Icon.tsx`.

**«Сделал» на задаче с несколькими исполнителями — свою часть или всю
задачу** (14.10.2026). Пока кто-то из остальных не ответил, кнопок две (в
боте — вопрос после «🏁 Сделал», действия `dpart`/`dall`); «всю задачу»
уводит на приёмку сразу (`closeIfEveryoneReported(…, whole)`), ответы
молчавших не выдумываются — на приёмке задачу держит колонка. И **на
приёмке исполнители не меняют ничего**, только пишут в обсуждение:
`openTaskChoices({ onReview })` закрывает все ответы во всех трёх дверях
(окно, маршрут, бот). Подробно — `docs/how-it-works.md`, «Кто что может».

**Возврат групповой задачи снимает отчёты только у ВЫБРАННЫХ, и есть
«Дождаться всех»** (21.10.2026, задача №111: один из шести случайно
«сдал целиком», а возврат стёр «Сделал» у троих, кто свою часть сдал).
Окно возврата спрашивает «Кому вернуть» кнопками (`pick` в `Ask.tsx` —
выбор людей в том же окне, что и текст), `applyReview(…, only)` снимает
ответы только у них и пишет имена в плашку и хронику; «Дождаться всех»
(`action: "wait"`) снимает приёмку, не трогая ничьих ответов. Бот: экран
«кому» под «↩ Вернуть» (`bk1`/`bkall`) и «⏳ Дождаться всех» (`wait`).
Не возвращайте общий возврат «всем сразу» как единственный — он и был
поломкой. И флаг «Каждый сдаёт сам» (`tasks.each_own`, миграция 0067,
выбор «Как сдают» в форме при нескольких исполнителях): «всю задачу» нет
в окне (`othersPending = 0`), в боте (развилки `dpart/dall` нет, старая
`dall` = своя часть) и в маршруте отчёта (`whole` игнорируется). Колонку
пишет синхронизация ВСЕГДА — миграция применена до кода. Подробно — `docs/how-it-works.md`, «Приёмка групповой задачи».

**Открытая задача сохраняется сама; кнопок внизу нет** (13.10.2026).
Шапка `ItemModalHead`: номер, название в рамке, справа «Принудительное
закрытие» (бывшее «волевым решением», только постановщику, комментарий
обязателен), «Отложить», корзина и ×. Ids прежние (`#cancelBtn` — это ×,
`#deleteTaskBtn`, `#snoozeTaskBtn`) — e2e держатся за них. Каждая правка
идёт через `onPatch` — кусок поверх ТЕКУЩЕЙ строки списка, не поверх
снимка, с которым окно открыли: снимок к моменту правки бывает старым, и
запись его целиком вернула бы прежнее молча. Отсюда два следствия, оба
легко сломать: `attachOnCreate` зовётся только для НОВОЙ задачи (раньше
каждое сохранение заводило заново человека, чьё имя осталось в поле
«Исполнитель», то есть снятого возвращало), и имя в `tasks.assignee`
переписывается вместе с составом (`syncAssigneeName`). Последнего
исполнителя снять или разжаловать нельзя — запрет стоит на самом
действии (`TaskPeople`), раз кнопки «Сохранить» больше нет.
Блока «Кто на задаче» нет: люди живут в сводке по ролям (`TaskPeople`
внутри `ItemFacts.footer`), «+» открывает окно `AddPeopleSheet` поверх
задачи. `TeamCompact` остался только решениями (перенос, приёмка, открыть
заново). Описание — свой блок под сводкой (`TaskDescription`), правится
постановщиком и пишется само (через секунду и при закрытии окна), с
файлами: `tasks.desc_files` (миграция 0053), папка `desc/` в той же
корзине. Встреча получила ту же шапку; её итог пишется при выходе из
поля. Стили всего этого — `src/app/task-ui.css`, подключён ПОСЛЕ
tracker.css нарочно (переопределяет прежний вид в одном месте).

**Задачи без исполнителя не бывает — ни одной дверью** (13.10.2026, «либо
ты сам, либо кто-то другой… без — нельзя»). Форма это запрещала давно, а
бот — нет: список дел после встречи без имени и «Поручить» по разделу, где
закреплены только соисполнители, заводили задачи ничьими. Теперь
исполнитель по умолчанию — тот, кто поручает (`authorAssigneeName` в
`assignExecutors`). `scripts/check-assignments.mjs` ищет и такие задачи
(«без исполнителя вовсе»), `--fix` ставит на них автора; три старые
исправлены так же. **И «закрой» в боте чужую работу молча не закрывает**:
на задаче с другими исполнителями команда ставила `status: done` мимо
приёмки — исполнитель не узнавал ничего (так закрылись №85 и №86 08.10).
Теперь бот отвечает, где закрыть со словами.

**Человека из команды УБИРАЮТ, а не удаляют** (14.10.2026, «добавь
функционал добавлять новых и удалять не нужных людей»). «+ Человек» в шапке
«Команды» и «Убрать из команды…» в меню ⋮ строки идут через
`/api/workspace/person` (add / remove / restore). Удалять строку `assignees`
нельзя: на ней каскадом держится всё участие — тем же `DELETE` был потерян
Котов. Поэтому `archived_at` (миграция 0055): человек уходит из «Команды», из
списков выбора (`useTrackerData`, `useColleagues`, `useTaskParticipants`,
разбор имён в `botPipeline`, `ownerNewTask`), теряет вход, мессенджеры,
ссылки и разделы, а закрытые задачи сохраняют его имя. По-настоящему
удаляется только строка без единого следа. Открытые дела (участие в
незакрытых задачах и будущих встречах, а также то, что он поручил) без
ответа «кому передать» не уходят: маршрут сначала считает их (`dryRun`),
окно спрашивает получателя под строкой, получатель ставится с ПУСТЫМИ
ответами, в обсуждение пишется строка хроники, получателю уходит одно
сообщение. Убранных видно внизу «Команды», «Вернуть» возвращает с историей;
добавление человека с именем убранного тоже его возвращает (имя уникально в
пространстве). Новое место, где из списка людей ВЫБИРАЮТ, обязано
фильтровать `archived_at is null`; места, где по id показывают имя из
истории, — нет. Сторож — `e2e/team.spec.ts`.
**А имя из истории помечается «удалён»** (21.10.2026, его слова: «в событиях
уже созданных… был маркер, что пользователь такой-то, имя сохраняется, но уже
удалён»). Кто убран — `useArchivedPeople` (общий store именами, следит за
`assignees`), пометка — `ArchivedMark`. Стоит в `PersonBadge` (значит, на
кубике и в составе задачи сразу; «Задача не дошла» у убранного не пишется),
«Постановщик» и «Назначил», участники встречи в окне и во всплывашке
карточки, автор реплики в обсуждении. Убранного нельзя тегнуть, и
«Повторить» прошедшую встречу на него не заводит. Новое место, где
показывают имя из истории, — с этой пометкой. Сторож —
`e2e/ideaActions.spec.ts` (там же меню «Отправить» мысли: добавили человека —
появился, убрали — пропал, без перезагрузки).

**У каждого окна × в правом верхнем углу, а не «Закрыть»/«Отмена» внизу**
(14.10.2026, «во всех окнах проверь и замени кнопки закрыть или отмена по
единому формату крестик в правом верхнем углу»). Шапка одна —
`ItemModalHead`, у служебных окон с `plain` (без рамки вокруг названия).
id прежних кнопок переехали на × (`#teamCloseBtn`, `#cancelBtn`,
`#meetingCancelBtn`, `#askCancelBtn`, `#confirmDateTimeCancelBtn`) — e2e
держатся за них. Нижняя кнопка отказа осталась только там, где у отказа
СВОИ слова (`cancelText`: «Не отменять», «Не сейчас») — это ответ, а не
выход. На телефоне × прячется только у окон со стрелкой «назад» (её рисует
`Modal`); у окна вопроса и выбора даты стрелки нет, и × остаётся.

**Закрытое событие — только просмотр** (14.10.2026, «в ранее завершённой
задаче и постановщик и исполнитель могут спокойно менять данные, удалять
сообщения и переписываться. Запрети любые изменения или дополнения уже
закрытых событий»). Закрыто — задача `done` или принятая разовая
(`taskDisplay.isClosed`), встреча с исходом (`success`/`no_result`, в
том числе перенесённая). У такой карточки нет срока, состава, описания,
«Отложить», «Удалить», просьб о переносе, итогов пунктов повестки и
«Больше не повторять»; обсуждение без поля ввода, реакций, «Изменить» и
«Убрать» (`ItemChat readOnly`, в меню остаётся «Копировать»). Остаются
«Повторить» и «В задачу» (это НОВОЕ, а не правка закрытого) и единственные
выходы назад — «Открыть заново» у задачи и «Вернуть в план» у встречи.
Граница стоит в трёх средах одним правилом: экран, база (миграция 0056,
`item_closed()` в политиках записи, правки и реакций) и бот
(`lib/closedItem` — бот пишет служебным ключом мимо политик, поэтому
«💬 Ответить», текст и файл в закрытое отвечают «🔒 уже закрыта»).
Исключение в базе одно и узкое: сообщение «Документы к …» с вложениями —
`answerFiles` шлёт его ПОСЛЕ ответа, который событие и закрыл (приёмка,
итог встречи). Колонки самой задачи база не сторожит: свою задачу
открывают снятием галочки через движок синхронизации. Сторож —
`e2e/closedReadOnly.spec.ts` и `closedItem.test.ts`.
**И о закрытом не напоминают** (28.10.2026, Макаров: пустой трекер и
утренняя «Вместе с вами: #111 … отчитались» по давно принятой задаче).
«Закрыта» в серверной выборке — это НЕ `status != done`: у задач,
принятых до 20.09, status так и остался `in_progress`. Закрыто = удалена,
`done`, или `approval_state = accepted` у разовой — то же, что
`taskDisplay.isClosed`. Так считают сводка (`managerBrief`, каждый блок, а
не только сроки), ступени просрочки (`escalation.findStuck`), «отложенная
вернулась» в кроне и очередь постановщику (`noticeQueue`). Новая рассылка
по задачам — с этим отбором.

**Срок обязателен у любой задачи, своей тоже** (14.10.2026, «запрети
ставить задачи без срока даже самому себе»). Форма не сохраняет новую
задачу без срока («Нужен срок» у метки, отказ в `save()`), у срока нет
«убрать»; исключение — повторяющаяся (её срок считает повтор). Серверные
двери идут через `newTaskRow`, и там срок не назван — неделя рабочим днём
(`defaultDeadline`); бот говорит об этом вслух (`deadlineNote`), кнопок
«Без срока» в мастере и в «мысль → задача» больше нет, а старая такая
кнопка в отправленном сообщении ставит неделю. Быстрый ввод — то же.
e2e: `ensureDeadline` в `e2e/helpers.ts` (его зовут `pickSelfExecutor` и
`pickAnyExecutor`) ставит «Через неделю», если тест срок не выбрал; форма,
открытая из мысли или повестки, зовёт его сама. Мастер «Поручить» в боте
спрашивает детали после названия (`stage: "desc"`, кнопка «Без описания»,
`nextNewTaskStep`), описание доходит до задачи — но НЕ до сообщения.
**Описания задачи в сообщениях бота нет вовсе** (22.10.2026, его слова:
«при оповещениях не выводи описания задачи, только наименования и
варианты решения и комментарии»): длинное описание хоронило кнопки и
слова, сказанные при смене состояния. Ни в присланной задаче
(`taskMessage`), ни в карточке исполнителя (`taskCard`, ею же
переписываются сообщения во всех мессенджерах), ни в карточке
постановщика (`ownerTaskCard`). Описание читают в самой задаче.

**Итог встречи пишется ОДИН раз, и закрытая встреча переписывается во всех
мессенджерах** (17.10.2026, снимки: «Тест прошел», «…2», «…3» подряд, и «в
максе пишешь итог — в телеге не видно»). Вопрос «Что решили?» с кнопкой
«Записать итог» уходил организатору в оба мессенджера и НЕ запоминался:
у владельца нет чата в строке людей, а `bot_messages` держится за
`assignee_id`. Теперь `notifyOwner`/`notifyAuthor` принимают `memo` и
запоминают сообщение на строке «(я)» (`botMirror.ownerSelfAssigneeId`), а
каждая дверь закрытия — бот (`closeMeeting`), трекер (`/api/workspace/recap`),
надиктованный итог (`telegramManage`) — зовёт `announceMeetingClosed`: все
сообщения о встрече у всех людей переписываются одной фразой
(`closedMeetingText`), «Записать итог» остаётся только у организатора и
только пока итога нет (`recordRecapButtons`). Ответ словами на
`meeting_recap` при уже записанном итоге отказывает, `mrec`/`mok`/`mno` у
закрытой встречи ничего не перезаписывают. Новое сообщение с кнопками о
встрече — передавайте `memo`, иначе оно выпадет из синхронизации.

**Шапка задачи и встречи — одна строка; «Отложить» — в строке срока**
(20.10.2026). `ItemModalHead` без `plain`: номер плашкой слева, название
многоточием (нажатие разворачивает), действия и ×; на телефоне
«Принудительное закрытие» подписано «Закрыть» (`.fc-short`). Кнопка
«Отложить» (`#snoozeTaskBtn`) — последней в `#selfDeadline` у своей задачи и
колонкой `extra` строки «Крайний срок» (`ItemFacts`) у поручения; подписана
днём возврата, когда отложена. Вопрос один на окно и меню карточки —
`snoozeAsk.chooseSnooze`: календарь и рядом «Завтра» / «Через неделю» с
днём недели — та же строка, что у срока (22.10.2026, «стандартное окно
календаря и варианты выбора число, завтра, через неделю»; `calendar` в
`ask.choose`), предупреждение, если задача вернётся просроченной. «Отложено» над
доской — ОТДЕЛЬНЫЙ взгляд (только отложенные, плашка `#snoozedBanner` с
«Вся доска», на карточке «Отложена до …»), и он не запоминается между
запусками: открыть трекер на доске без рабочих задач — это «всё пропало».

**Кнопки окна задачи и встречи — одного формата, образец «Отложить»**
(21.10.2026, его слова: «все кнопки были по единому формату, как ты сделал
кнопки в созданной задаче „Отложить“ и „+“»). Залитая фирменным цветом, с
бликом сверху и тенью, проседает при нажатии: шапка (`.item-head-btn`),
«Добавить/Готово» у описания (`.desc-edit`), микрофон у полей окна, все
`.btn-primary`. Блок в конце `task-ui.css`, одно правило на все. Цвет
отличается только по смыслу: «Принудительное закрытие» мягко-зелёное (его
просьба), запись микрофона — красная заливка той же формы. Серые `.btn`
остались вторым выбором рядом с главным («Вернуть» рядом с «Принять»):
две одинаковые заливки рядом не говорят, какая кнопка главная. Микрофон в
строке чата — круглый, как в Telegram, — сюда не входит.

**Девять предложений 13.10.2026, одобренных 14.10.2026** — что где живёт:
*История срока* — триггер `tasks_deadline_history` (миграция 0058):
`first_deadline` и `deadline_moves` считает база, любой дверью; на кубике
`.task-moves`, в окне — «переносили N×, изначально …». Первое появление
срока у задачи без срока переносом не считается.
*«#номер» в обсуждении* — `splitLinks` в `lib/chatText` режет «#107» в
кнопку, нажатие шлёт событие окна `OPEN_TASK_NUMBER_EVENT`, задачу
открывает `NewTracker` — только из ВИДИМЫХ. Запрошенная задача сильнее
открытого окна (`modalTask = requestedTask ?? …` в `TasksPanel`).
*Чек-лист* — таблица `task_checklist` (0059) рядом с задачей, не колонка:
отмечают исполнители, а строку задачи пишет только постановщик. Ведут
постановщик, исполнители, соисполнители; наблюдатель смотрит; у закрытой —
ничего (`item_closed`). Своя `my_row_in()` в базе — потому что
`my_assignee()` без 0057 не знает строку владельца. Хук `useTaskChecklist`,
на кубике «3/5» (`useChecklistCounts`, одна выборка на доску).
*Приёмка по выбору* — `tasks.needs_review` (0060, по умолчанию да). «Без
приёмки» выбирают в форме, когда исполнитель не только я; отчитались все и
отказов нет — `closeIfEveryoneReported` закрывает задачу через
`applyReview("approve")` словами отчётов.
*Зависимость* — `tasks.blocked_by` (0061), одна на задачу, выбор только из
открытых с НОМЕРОМ (номер ставит база — значит задача уже в облаке, и
внешний ключ не уронит пачку синхронизации). На кубике «Ждёт #N», пока та
открыта; приёмка/закрытие той шлёт исполнителям «🟢 Можно начинать»
(`tellUnblocked` в `reviewWork`).
*Задачи из повестки* — `MeetingTasksSheet`: пункты — это ПОВЕСТКА
встречи, а не итог, порезанный на строки (16.10.2026: «предлагай к
постановке задачей повестки, а не итоговое описание»); «что решили» по
пункту уходит в описание задачи. Человек и срок — у каждого, создаются
только по «Поставить», рядом «Не ставить задачей». Открывается само после
«Успех» И «Провал», если повестка не пуста (`loadAgenda`), и кнопкой
«Задачи из повестки» в самой повестке закрытой встречи. Повестки нет —
после «Успеха» прежний вопрос «Поставить задачу?», но название задачи
пустое: итог идёт в описание.
*Повестка при создании* (21.10.2026, «поле повестка должно быть доступно
при создании любой встречи… между названием встречи и датой»):
`AgendaDraft` в форме новой встречи, перенос подставляет повестку прежней
(`prefill.agendaFrom`). Пункты живут в форме, пока встречи нет в базе;
`saveAgendaDraft` ждёт её строку и пишет их ДО приглашения — оно читает
повестку из базы и несёт её людям (`meetingMessage(…, agenda)`). В боте —
поле `agenda` у `create_meeting` («…, повестка: смета; отпуска»), кнопка
«📝 Повестка» (`m:magd`, pending `meeting_agenda`: следующее сообщение —
пункты, по строке или через «;», запятая не режет) под созданной встречей
и в карточке у организатора; дописывает всё одна `appendAgenda`.
*Опрос времени* — предложенная встреча с `slot_options` (0062, два и
больше). Голоса — `meeting_slot_votes`, пишет только маршрут
`/api/workspace/slot-vote` и бот (кнопки `m:slot:<id>.<n>`,
`pollButtons`), потому что после голоса надо решить, не пора ли назначать:
ответили все — вариант с наибольшим числом голосов, свободный у всех
(`busyOnServer`), назначается (`lib/meetingPoll.applySlot`). «Буду» опрос не
назначает (`meetingConfirm` пропускает опросы), кнопок «Буду» у опроса нет.
Чистая часть — `lib/meetingPollRules` (окно встречи не должно тянуть
серверную рассылку).

**Бот умнее не моделью, а тем, что видит разговор** (20.10.2026, его
слова: «Гига чат не достаточно умно отвечает… простая просьба о переносе
конкретной встречи так и не решилась… улучши механизм работы и его
обучаемость»). 19.10 он семь сообщений подряд переносил одну встречу, и
причин было четыре, модель — лишь одна из них.
*Модель.* Бот жил на «GigaChat» (Lite), хотя ключ открывает старшие:
`/api/v1/balance` показал нетронутые пакеты Max (25 млн) и Pro (40 млн).
Теперь `gigachat/client` идёт цепочкой `GigaChat-2-Max → 2-Pro → GigaChat`:
402/429/404/5xx/таймаут 25 с — следующая модель, и упавшая пропускается
десять минут. Сводки (`tier: "light"`) — с Pro: там модель только
переписывает готовые факты. `GIGACHAT_MODEL` в окружении ставит модель
первой без выкладки.
*Разговор* (`lib/botMemory`, таблица `bot_dialog`, миграция 0065): модель
видит последние полчаса чата, поэтому «Только телемост», «На 26.10», «26.10»
читаются как уточнения. Записывает ОБЁРТКА транспорта (`recordingTransport`)
— не каждый `say`, их десятки. Крон чистит старше двух суток.
*Реплай*: вебхуки передают сообщение, на которое ответили (Telegram
`reply_to_message`, MAX `link.type = "reply"`), с данными его кнопок — id
дела из кнопки надёжнее любого названия (`replyContext`).
*Перенос одной вещи* — намерение `move_item` (раньше был только «перенеси
ВСЁ с дня на день», куда и уезжала любая просьба). Модель отдаёт ЧТО и
КОГДА словами, дату считает код (`lib/botWhen`: «26.10», «26 октября»,
«следующий понедельник», «на неделю» — сдвиг от даты самой встречи, «в то
же время»), дело ищется по словам с опечатками (`lib/itemMatch` —
«Яценко» находит «Яцнко»; подстрока не находила). Перенос встречи — НОВАЯ
встреча и прежняя, закрытая как перенесённая, ровно как в трекере
(`lib/itemMove.moveMeeting`; рассылку «было → стало» с маршрутом
`meeting-moved` делит `announceMeetingMove`). Массовый перенос
(`bulkActions.applyBulkMove`) с того же дня идёт через те же функции —
каждая встреча и задача по отдельности, время встречи прежнее; что не
перенеслось (занято, прошло), перечисляется, а не роняет весь список.
Третьего способа перенести встречу не заводите.
*Отмена словами* — намерение `cancel_meeting` (до 20.10.2026 «отмени встречу»
уходило в `manage_item delete` и молча стирало её): поиск общий с переносом
(`findItems`), отменяет только назначивший, без причины не отменяется —
причина во фразе даёт сразу «да?», без неё бот её спрашивает, как после
кнопки «🚫 Отменить». Удаление задачи осталось `manage_item delete`.
*Десять умений словами* (20.10.2026, его «давай» на список) — `lib/botSkills`,
по намерению на умение: `review_task` (принять / вернуть с причиной),
`task_people` (подключить, снять, «теперь ведёт»), `meeting_people`
(позвать с приглашением, убрать с сообщением), `find_slot` (общие свободные
получасы → кнопка времени → название → встреча), `remind_me` (таблица
`bot_reminders`, миграция 0066, шлёт крон; время считает `parseDue`),
`repeat` у задачи и встречи (`parseTaskRepeat` / `parseMeetingRepeat`;
день повторяющейся встречи считает код — модель ставила «по вторникам» на
среду), `idea_to_task`, `agenda_add`, `checklist`, `nudge` (одна задача или
«все просроченные»). Чужая работа и рассылка пачкой ждут «да» или кнопку
(`bot_confirm`: сама операция лежит в памяти чата, кнопка `t:cfgo:x`);
своё — повестка, чек-лист, напоминание себе — делается сразу. Чек-лист
словами ведёт и ИСПОЛНИТЕЛЬ (21.10.2026, «сделай, чтобы исполнитель тоже
мог»): задача ищется среди поставленных И тех, где он исполнитель или
соисполнитель; у человека без входа фразу с глаголом отметки
(`CHECKLIST_HINT` в colleagueReplies) разбирает `checklistForPerson` ДО того,
как текст уйдёт репликой в обсуждение, но после незакрытых вопросов бота;
добавлять пункты он не может — у пункта автор-учётная запись. Модель
кладёт «отметь цены» то в done, то в add — глагол отметки во фразе решает
за неё, а пункт, который уже есть, второй раз не заводится. Нажатию
кнопки модуль умений подгружается динамически: он тянет разбор фразы с
GigaChat. Заодно встреча, надиктованная боту, теперь рассылает
приглашения (`createMeetingFromBot`) — раньше не уходило ничего.
Проверка — девять пунктов в `test:bots`, на настоящей модели.
**Порт 3100 бывает занят чужим сервером** соседней сессии: `test:bots`
против него проверяет не ваш код. Свой — на другом порту.
*Ответ на «Переношу? да?», который не «да» и не «нет», — уточнение, а не
отмена* (`passesThrough`): идёт в обычный разбор вместе с разговором.
Удаление и список задач после встречи по-прежнему отменяются любым словом.
*Уроки* (`bot_lessons`): фраза и разбор, подтверждённые «да» или кнопкой,
подкладываются модели примером, когда тот же человек скажет похожее. Урок —
человека, не пространства: чужая фраза в чужую подсказку не попадает.
*Кнопки* (`lib/botMoveFlow`): «📅 Перенести» и «🚫 Отменить» (с причиной)
в карточке встречи, «📅 Перенести срок» в карточке задачи, «📅 Перенести»
под напоминанием организатору и «📅 Не было — перенести» под «Что
решили?». Экран дней → экран времени (свободные у приглашённых часы, «в
то же время» первым) — второе нажатие и есть подтверждение. Данные кнопки
несут всё (`id.ГГГГММДДЧЧММ`, до 64 байт), память нужна только тексту.
Участнику под приглашением — «📆 Предложить другое время»: это то же
предложение, что в трекере (реплика с `proposal`), и доставляет его та же
`commentDelivery` с «подходит / не подходит» и «Перенести на это время».
*MAX — меню вместо приложения* (его слова: «в МАХ вместо приложения
сделать работу с меню»): кнопка мини-приложения вырезается на выходе в
MAX (`keyboardAttachment`), одним местом на все меню; «приложение» словом
отвечает меню кнопок. Кнопку «Открыть» внизу чата ставит кабинет MAX, не
код, — её смена отправляет бота на модерацию.
Проверять разбор — на живой модели, не чтением: 19.10-фразы прогнаны через
`parseQuickAdd` с той же подсказкой, все девять разобраны верно.

**Аудит 20.10.2026 на десяти аккаунтах — три дыры в маршрутах, и все
три одного вида: интерфейс кнопку прятал, а маршрут действие принимал.**
(Его просьба: «большой аудит логики… на базе десяти тестовых аккаунтов»;
сторож — `npm run test:ten`.)
*Принять задачу, от которой все отказались, было можно* — `applyReview`
теперь отказывает, если отчётов нет, а отказ есть: закрывают такую задачу
принудительно («невыполненной»), а не приёмкой с «работу приняли».
*Наблюдатель мог ответить «Сделал / Не могу / Принял»* через
`/api/workspace/report` — бот это отсекал, маршрут нет. Теперь 403.
*Итог встречи из трекера записывался сколько угодно раз* — две рассылки
участникам и две строки «Встреча прошла успешно». Признак повтора —
строка итога в хронике, написанная после текущего `resolved_at`; после
«Вернуть в план» и нового закрытия итог законно пишется снова.
Общее: **кнопка, которой нет на экране, — не защита.** Старая кнопка под
сообщением бота, вторая вкладка и подделанный запрос до маршрута доходят;
правило живёт в маршруте или в базе, экран его только повторяет.

**Скорость и вид, тот же аудит.** Окна (задача, встреча, «Команда»,
кабинет, поиск, повестка, разделы, «Завершённые») — отдельными
кусками через `next/dynamic` (`lib/lazyWindows`), подгружаются фоном после
первого кадра: точка входа главной 732 → 603 КБ. Новое окно по кнопке —
туда же, иначе оно снова поедет в первый кадр. Сообщение постановщику из
`/api/workspace/report` уходит после ответа (`after`), независимые записи
— одним `Promise.all`. Стили: четыре скругления (`--radius-xs/sm/md/lg`)
вместо двадцати трёх цифр и целые пиксели шрифта вместо шести
полупиксельных ступеней; текстовый зелёный — `--ok-ink` (`--long-border` —
цвет РАМКИ, текст им не прочитать). Встреча без итога — красной рамкой без
заливки, пилюля «Нужен итог» внутри одноимённой группы не повторяется;
«Успех / Провал» — одни и те же слова в списке и в окне.
**Шрифт в тот же день пришлось вернуть.** Округление 12,5 → 13 и 13,5 →
14 сделало каждую подпись на полпикселя шире, и строки, стоявшие
впритык, начали переноситься: «Завершённые» и «+» у разделов на вторую
строку, «Крайний срок» в две строки. Его слова: «почему всё
посъезжало???». Размеры шрифта — ровно прежние (скругления остались
едиными). Урок: **размер текста — это ширина каждой кнопки в каждом
ряду**; менять его можно только с замером переносов на всех ширинах, а не
глазом на одном экране.
**Полоса над доской и строка разделов — одной строкой всегда** (его
слова: «все разделы должны быть в одну строчку, с минимальными
отступами… то же самое в мобильной версии»). Блок в конце `tracker.css`:
`nowrap`, промежутки 1–6px, прокрутка вбок без полосы как последний
запас. Когда доске тесно (`@container` по `.dash-panel`: 1250 / 980 /
860px), сперва уходят СЛОВА (`.fp-word`: «Новая задача»; «Просрочено» и
«Отложено» с 22.10.2026 в шапке, «Завершённые» подписано всегда), потом
уплотняются разделы — кнопки
не срезаются краем. Проверено замером `scrollWidth ≤ clientWidth` на
1920, 1600, 1440, 1366, 1100, 900 и 390 px с одиннадцатью разделами.
Добавляете кнопку в полосу — повторите этот замер.

**Название, которое пишет человек, на рабочем поле — не больше трёх
строк** (21.10.2026, встреча «1111…» без пробелов легла в список столбцом
по букве на всю высоту панели: «элементарные вещи отследить не можешь»).
У кубика задачи предел был, у карточки встречи — нет, и так же без
предела жили окно дня, «Завершённые», приёмка, всплывашка и плашка
переноса. Теперь везде `line-clamp` (2–3 строки) плюс
`overflow-wrap:anywhere`, плашка переноса — одной строкой с многоточием,
а целиком название видно окном по наведению (`.task-peek`, у встречи
тоже) и в окне самого дела. Новое место, где выводится название, —
сразу с пределом; сторож — второй тест в `e2e/textCap.spec.ts` (600
символов без пробела, высота в строках по браузеру).

**Всё, что раскрывается, раскрывается плавно — одним механизмом**
(21.10.2026, его слова: «большое описание плавно спокойно выплывало, без
резких рывков… всё, что раскрывает полное описание или информацию, —
разворачивалось плавно и аккуратно»). `lib/smoothHeight`: `grow` (сперва
состояние через `flushSync`, потом рамка дорастает) и `shrink` (сперва
едет рамка, состояние меняется в конце — иначе текст схлопывается
мгновенно, и плавно уезжает пустое место); блок, который появляется, —
`Reveal`. Подключено: название в шапке задачи и встречи, «Показать
полностью», «Люди» в «Разделах», строки
колокольчика, сворачивание столбцов доски. Шапка задачи выровнена по
ВЕРХУ — по центру номер и кнопки уезжали к середине развёрнутого
названия; развёрнутое — не выше `min(34vh,300px)`, дальше прокрутка.
Отступ у раскрывающегося блока — `padding`, не `margin` (margin вне
высоты появляется скачком). Новое раскрытие — через эти функции, а не
`{open && …}` голым. Сторож — `e2e/smoothExpand.spec.ts` (высота посреди
перехода и номер, не сдвинувшийся ни на пиксель).
**Окна — так же** (тем же днём: «сделай так же плавно открытие и закрытие
окон»). Появление — без «пружины» (`--win-in`, `--win-ease` в
`tracker.css`). Закрытие делает `lib/leaveGhost`: окно закрывает родитель,
убирая его из разметки, и учить три десятка родителей ждать анимацию
незачем — в момент закрытия на месте окна гаснет СЛЕПОК, а само окно уже
закрыто (фокус, Esc и следующее действие ничего не ждут). Слепок живёт в
ЗАКРЫТОМ shadow DOM со стилями документа, скопированными одним листом, и
это не украшение: первая версия клала его прямо в документ, и на 200 мс в
нём было два `.ask-modal` — тринадцать e2e упали на строгом режиме
Playwright. Так же уходит шторка календаря (`CalSheet` в `MiniCalendar`).
Новое всплывающее — через `useLeaveGhost`.

**Бот знает трекер — справочником, а не моделью** (аудит ботов
20.10.2026, его слова: «они должны знать всё о текущем функционале
трекера и быть лучшими помощниками»). Нашлось три вида незнания.
*Не мог рассказать.* «Как отложить задачу?» уходило в `question` — шаг,
который знает ДАННЫЕ («что у меня завтра»), а не устройство трекера.
Теперь тип `howto`: модель выбирает ключ темы из закрытого списка, слова
ответа — из `lib/botGuide` (модель не пишет фактов, а описание трекера —
факты). Оттуда же собрана «помощь» (`assignerHelp` по разделам, справка
получателя). **Добавляя умение боту или кнопку трекеру — допишите тему в
`GUIDE`**, иначе бот снова умеет то, о чём не может сказать; тест
`botGuide.test.ts` проверяет, что все ключи попадают в подсказку.
*Не умел.* «Отложить» и «Меня не будет» — кнопки трекера, которых в боте
не было ни словом, ни кнопкой (`lib/botSelf`: `snooze_task`, `away`;
касаются только самого пишущего — без «да»).
*Не давал руководителю.* Его ветка (`offerTask`) понимала только
поручения, перенос и умения: мысль, встреча и вопрос словами получали в
ответ справку. Теперь они идут общим `respondToTool` от его имени: мысль
с его `created_by`, встреча через `createMeetingFromBot`, вопрос и поиск
— по ЕГО делам (`Viewer` в `lib/telegramQueries`, `buildTrackerContext` и
`searchTracker` с третьим аргументом). `manage_item` руководителю НЕ
отдан: его выборка написана по пространству и нашла бы чужое.
Проверено на живой модели: 15 фраз из 15 (новые типы и соседние, которые
не должны с ними путаться); в `test:bots` — мысль и «меня не будет» у
руководителя, «отложи / верни на доску» у владельца.

**Бот разговаривает, а не только исполняет** (22.10.2026, его слова:
«мне нужна максимально общительная и умная версия в рамках работы
трекера»). На «привет», «спасибо», «как дела», «устал, завал» бот отвечал
заготовкой «Не понял, что сделать» — модель отличала такие фразы и раньше
(`other`), отвечать было нечем. Теперь тип `chat` → `small_talk` →
`lib/botTalk.talkReply`: слова пишет модель (тепло, 1–3 фразы, на «вы»,
по имени), а о делах она вправе сказать только `pulseFacts` — сколько
задач и встреч сегодня, просрочка, ближайшая встреча, посчитанные
`trackerPulse` (тот же отбор «своё и где участник», что у вопроса).
`talkIsSafe` сверяет числа (и словами — «две встречи»: живая модель писала
их так) и названия в ёлочках с фактами; не прошёл — `fallbackTalk` того же
смысла. Под ответом кнопки ровно к сказанному («⚠ Просрочено»,
«📌 Сегодня») — обычные, не экранные. «Привет, что у меня сегодня?» — это
вопрос, а не два ответа (`dropTalkBesideWork`).
Вопрос о делах видит разговор: «а у Игоря?» модель разбора собирает в
полный вопрос, а шаг ответа читает те же полчаса переписки и заканчивает
одним следующим шагом фразой, которую можно написать боту
(«поторопи Игоря по смете»). Отказ модели — «Помощник сейчас не
отвечает» с кнопками, а не «Не получилось разобрать: GigaChat 503».
Проверено на живой модели: 15 фраз разобраны верно, девять реплик
получили живые ответы с верными цифрами; в `test:bots` — «спасибо» у
руководителя.

**Аудит 29.10.2026: ошибки, скорость, взлом — по десять в каждом**
(его слова: «не останавливайся пока по каждому пункту не найдешь по 10
реальных ошибок и не исправишь»). Каждая правка подписана в коде; здесь —
правила, которые из них следуют.
*Секрет сравнивается через `lib/secretMatch`, и пустой не совпадает ни с
чем.* `x !== process.env.SECRET` открывал вебхук Telegram при незаданной
переменной (`undefined !== undefined` — false), а резервная копия ждала
буквально «Bearer undefined». То же у крона напоминаний и вебхука MAX.
*Владелец доказывается тем, что он есть.* `/api/max/setup` пускал всякого,
у кого не нашлось членства (`maybeSingle` даёт null и при двух строках) —
то есть мог заменить токен бота и читать всё. Теперь: ни одного членства в
чужом пространстве И своя строка «(я)».
*Адрес в ссылке — только `originOf`, и только свой хост.* Публичный
«Забыли пароль?» с подставленным `X-Forwarded-Host` отправил бы человеку
настоящее сообщение бота со ссылкой на чужой сайт. У `/api/workspace/invite`
и `/api/max/setup` были свои копии — удалены.
*Публичный маршрут без входа — с общим пределом.* Журнал поломок принимал
анонимные строки без счёта и делал из каждой задачу на GitHub (теперь
задачу — только от вошедшего); заявки входа через мессенджер — тоже.
*Id из запроса проверяется на «моё», каждый.* `meeting-moved` проверял
прежнюю встречу и верил новой — так рассылалось «было → стало» по чужой;
`participant-note` писал имя человека из чужого пространства.
*Свободный текст — с пределом длины* (итог, причина отмены, быстрый ввод,
список адресатов): сообщение длиннее ~4 тысяч знаков мессенджер не
принимает вовсе, а быстрый ввод оплачивается токенами модели.
*«Один раз» — условным UPDATE, а не проверкой перед записью.* Так теперь
устроены: взять мысль в работу (`lib/ideaClaim`, иначе две задачи),
перенос встречи на предложенное время (иначе две новые встречи), ответ на
просьбу о переносе срока, отмена встречи. Проверка «а не сделано ли уже»,
стоящая ДО записи, пропускает второе нажатие, пришедшее в ту же секунду.
*Нажатия Telegram дедуплицируются, как и сообщения:* `update_id` теперь
записывается ДО разбора кнопки — повтор доставки медленного ответа
нажимал «Сделал» второй раз (у MAX так было с самого начала).
*Закрытая задача — только просмотр и в маршруте приёмки:* возврат одного,
срок и ответ на перенос у неё — 409; выход один, «Открыть заново».
*«Сегодня» на сервере — `todayMoscow()`*, а не `toISOString().slice(0,10)`:
с полуночи до трёх по Москве это был вчерашний день — в боте («Сегодня»,
«Просрочено», «сдвинуть на день») и у галочки повторяющейся задачи в
браузере (она тут же открывалась снова; там — `todayStr()`).
*Перенесённая встреча не попадает в календарь телефона* (`moved_to_date`).
*Рассылка и правка многих строк — разом или одним `.in()`*: крон («время
вышло», «ждёт ответа»), «можно начинать», передача работы ушедшего,
переименование человека, поиск чатов адресатов в `/api/telegram/send`.
`forgot-password` больше не выкачивает всех пользователей
(`lib/findUserByEmail` — параметр `filter` сервера входа).
*Фоновая вкладка перечитывает впятеро реже* (`HIDDEN_SLOWDOWN` в
`lib/revive`); не замедляются только уведомления на ПК и очередь ответов
(`background: true`). Новый подписчик догона, который обязан работать в
свёрнутом окне, — с этим флагом.

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
- **The owner's morning brief is gone** (28.10.2026, see «Владельческой
  утренней сводки нет» above). The rule it was built on still holds for
  every summary that remains: the model may reword, it may not count.
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
