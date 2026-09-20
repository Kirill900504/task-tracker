// Многопользовательский трекер, прогнанный целиком — как это делают люди.
//
// До сих пор проверялось всё, кроме главного. `npm run test:rls` знает про
// личные таблицы и ничего не знает про task_participants, meeting_participants
// и item_comments — то есть ровно про те, где живёт «кто что видит».
// `npm run test:bots` проверяет мессенджеры. `npm run test:schema` проверяет
// схему на пустой копии и не запускается на Windows (нужен postgres рядом).
// А документ docs/multiuser.md заканчивается честной строкой: «Ничего из
// написанного 9 сентября не проверено на живых данных».
//
// Этот скрипт и есть та проверка. Он заводит одноразового владельца и двух
// одноразовых руководителей (настоящие учётные записи, настоящие сессии,
// настоящие HTTP-запросы к маршрутам) и проходит сценарии: приглашение и
// вход, задача на двоих, приёмка и возврат, отказ, встреча с
// переголосованием, мысль в работу, обсуждение, отключение доступа. В конце
// удаляет за собой всё.
//
// Безопасно против боевого развёртывания по той же причине, что и e2e: все
// строки принадлежат созданным здесь учётным записям, и ни к одному из них
// не привязан мессенджер — значит, ни одно уведомление не уйдёт живому
// человеку.
//
//   npm run test:workspace                    # против продакшна
//   npm run test:workspace -- http://localhost:3100
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";

const base = (process.argv[2] || "https://task-tracker-beta-ebon.vercel.app").replace(/\/+$/, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Нужен --env-file=.env.local");

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)?.slice(0, 300)}`);
  if (!ok) failures++;
}
function section(title) {
  console.log("\n" + title);
}

// Сессия настоящая, а не подделанная: клиент @supabase/ssr сам кладёт в
// «банку» ровно те куки, которые потом читает сервер. Собирать их руками
// значило бы проверять свою догадку о формате, а не работу приложения.
async function signIn(email, password) {
  const jar = new Map();
  const db = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Вход ${email}: ${error.message}`);
  return {
    db,
    id: data.user.id,
    email,
    cookie: () => [...jar.entries()].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; "),
  };
}

async function post(actor, path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(actor ? { cookie: actor.cookie() } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const created = [];
async function makeUser(tag) {
  const email = `wstest-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.invalid`;
  const password = "Ws-" + randomUUID().slice(0, 12) + "!Aa1";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  created.push(data.user.id);
  return { id: data.user.id, email, password };
}

async function cleanup() {
  for (const id of created) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

const soon = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
const later = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);

try {
  // ── Подготовка ─────────────────────────────────────────────────────────
  section("Приглашение и вход");
  const ownerAuth = await makeUser("owner");
  const owner = await signIn(ownerAuth.email, ownerAuth.password);

  // Люди заводятся так же, как их заводит трекер: строкой в assignees,
  // через клиент владельца, то есть под теми же правилами доступа.
  const { data: people, error: peopleError } = await owner.db
    .from("assignees")
    .insert([
      { user_id: owner.id, name: "Тест Козлов" },
      { user_id: owner.id, name: "Тест Витковский" },
    ])
    .select("id, name");
  check("владелец заводит двух людей", !peopleError && people?.length === 2, peopleError?.message);
  if (!people || people.length !== 2) throw new Error("без людей дальше нечего проверять");
  const [personA, personB] = people;

  const inviteA = await post(owner, "/api/workspace/invite", { assigneeId: personA.id, direction: "Продажи" });
  check("приглашение выдано", inviteA.status === 200 && !!inviteA.body?.code, inviteA);
  const inviteB = await post(owner, "/api/workspace/invite", { assigneeId: personB.id, direction: "Сервис" });
  check("второе приглашение выдано", inviteB.status === 200 && !!inviteB.body?.code, inviteB);

  const passA = "Ws-" + randomUUID().slice(0, 12) + "!Aa1";
  const emailA = `wstest-a-${Date.now()}@example.invalid`;
  const joinA = await post(null, "/api/workspace/join", { code: inviteA.body.code, email: emailA, password: passA });
  check("первый руководитель заводит себе вход", joinA.status === 200, joinA);

  const passB = "Ws-" + randomUUID().slice(0, 12) + "!Aa1";
  const emailB = `wstest-b-${Date.now()}@example.invalid`;
  const joinB = await post(null, "/api/workspace/join", { code: inviteB.body.code, email: emailB, password: passB });
  check("второй руководитель заводит себе вход", joinB.status === 200, joinB);

  const reuse = await post(null, "/api/workspace/join", { code: inviteA.body.code, email: `x-${Date.now()}@example.invalid`, password: passA });
  check("использованное приглашение второй раз не работает", reuse.status === 400, reuse);

  // Владелец, открывший ссылку не выйдя из аккаунта, стал бы участником
  // собственного трекера — и увидел бы экран руководителя вместо своего.
  const inviteC = await post(owner, "/api/workspace/invite", { assigneeId: personB.id });
  const selfJoin = await post(owner, "/api/workspace/join", { code: inviteC.body?.code || "-" });
  check("владелец не может принять приглашение в свой же трекер", selfJoin.status === 400, selfJoin);

  const mgrA = await signIn(emailA, passA);
  const mgrB = await signIn(emailB, passB);
  created.push(mgrA.id, mgrB.id);

  const dup = await post(owner, "/api/workspace/invite", { assigneeId: personA.id });
  check("повторное приглашение вошедшего отклоняется", dup.status === 409, dup);

  // ── Задача на двоих ────────────────────────────────────────────────────
  section("Задача на двоих: принял → сделал → приёмка");
  const taskId = randomUUID();
  const { error: taskError } = await owner.db.from("tasks").insert({
    id: taskId,
    user_id: owner.id,
    title: "Собрать отчёт по марже",
    assignee: personA.name,
    priority: "high",
    term: "short",
    status: "in_progress",
    deadline: soon,
    created_by: owner.id,
  });
  check("владелец создаёт задачу", !taskError, taskError?.message);

  // Первого назначает само имя в поле «Исполнитель» — с миграции 0024 это
  // свойство базы, а не внимательность того, кто писал очередной способ
  // завести задачу. Второго добавляем списком, как это делает карточка.
  const { data: auto } = await owner.db.from("task_participants").select("id, assignee_id").eq("task_id", taskId);
  check("имя в поле само завело исполнителя", (auto || []).length === 1 && auto[0].assignee_id === personA.id, auto);

  const { error: partsError } = await owner.db
    .from("task_participants")
    .insert([{ user_id: owner.id, task_id: taskId, assignee_id: personB.id, role: "executor" }]);
  check("второй добавлен списком участников", !partsError, partsError?.message);

  const { data: parts } = await owner.db.from("task_participants").select("id, assignee_id").eq("task_id", taskId);
  check("оба назначены исполнителями", (parts || []).length === 2, parts);
  const partA = parts.find((p) => p.assignee_id === personA.id);
  const partB = parts.find((p) => p.assignee_id === personB.id);

  const { data: seenByA } = await mgrA.db.from("tasks").select("id, title").eq("id", taskId).maybeSingle();
  check("исполнитель видит свою задачу", seenByA?.id === taskId, seenByA);

  const accept = await post(mgrA, "/api/workspace/report", { action: "accept", participantId: partA.id });
  check("«принял» проходит", accept.status === 200, accept);

  const noComment = await post(mgrA, "/api/workspace/report", { action: "done", participantId: partA.id });
  check("«сделал» без комментария отклоняется", noComment.status === 400, noComment);

  const doneA = await post(mgrA, "/api/workspace/report", { action: "done", participantId: partA.id, comment: "Свёл цифры за август" });
  check("«сделал» с комментарием проходит", doneA.status === 200, doneA);
  check("пока отчитался один — приёмка не предлагается", doneA.body?.awaitingReview === false, doneA.body);

  const foreign = await post(mgrB, "/api/workspace/report", { action: "done", participantId: partA.id, comment: "я за него" });
  check("отчитаться за другого нельзя", foreign.status === 403, foreign);

  const noReason = await post(mgrB, "/api/workspace/report", { action: "decline", participantId: partB.id });
  check("«не могу» без причины отклоняется", noReason.status === 400, noReason);

  const declineB = await post(mgrB, "/api/workspace/report", { action: "decline", participantId: partB.id, comment: "Нет доступа к 1С" });
  check("«не могу» с причиной проходит", declineB.status === 200, declineB);

  const doneB = await post(mgrB, "/api/workspace/report", { action: "done", participantId: partB.id, comment: "Доступ дали, собрал" });
  check("отчёт после отказа проходит", doneB.status === 200, doneB);
  check("отчитались все — задача ушла на приёмку", doneB.body?.awaitingReview === true, doneB.body);

  const { data: afterDone } = await admin.from("tasks").select("approval_state").eq("id", taskId).maybeSingle();
  check("approval_state = awaiting_review", afterDone?.approval_state === "awaiting_review", afterDone);

  const { data: declinedRow } = await admin.from("task_participants").select("declined_at, decline_reason").eq("id", partB.id).maybeSingle();
  check("отказ снят отчётом, а не остался висеть", !declinedRow?.declined_at, declinedRow);

  // ── Приёмка ────────────────────────────────────────────────────────────
  section("Решение постановщика");
  const selfReview = await post(mgrA, "/api/workspace/review", { action: "approve", taskId });
  check("исполнитель не может принять свою работу", selfReview.status === 403, selfReview);

  const returnNoComment = await post(owner, "/api/workspace/review", { action: "return", taskId });
  check("возврат без комментария отклоняется", returnNoComment.status === 400, returnNoComment);

  const returned = await post(owner, "/api/workspace/review", { action: "return", taskId, comment: "Нет разбивки по филиалам" });
  check("возврат на доработку проходит", returned.status === 200, returned);

  const { data: afterReturn } = await admin.from("tasks").select("approval_state").eq("id", taskId).maybeSingle();
  check("approval_state = returned", afterReturn?.approval_state === "returned", afterReturn);

  const { data: clearedParts } = await admin.from("task_participants").select("done_at").eq("task_id", taskId);
  check("отчёты обнулены, чтобы было что доделывать", (clearedParts || []).every((p) => !p.done_at), clearedParts);

  await post(mgrA, "/api/workspace/report", { action: "done", participantId: partA.id, comment: "Добавил филиалы" });
  const redone = await post(mgrB, "/api/workspace/report", { action: "done", participantId: partB.id, comment: "Проверил" });
  check("после доработки задача снова ждёт приёмки", redone.body?.awaitingReview === true, redone.body);

  const approved = await post(owner, "/api/workspace/review", { action: "approve", taskId, comment: "Годится" });
  check("приёмка проходит", approved.status === 200, approved);
  const { data: afterApprove } = await admin.from("tasks").select("approval_state, approved_at, status, completed_at").eq("id", taskId).maybeSingle();
  check("approval_state = accepted", afterApprove?.approval_state === "accepted", afterApprove);
  // Принято — значит закрыто. Раньше статус переключала вкладка уже после
  // ответа маршрута, и эхо realtime успевало стереть это переключение:
  // работа принята, комментарий записан, а задача висит открытой.
  check("принятая задача закрыта", afterApprove?.status === "done" && !!afterApprove?.completed_at, afterApprove);

  // ── Хроника ───────────────────────────────────────────────────────────
  section("История задачи");
  // Ради этого всё и делалось: возврат на доработку обнуляет отчёты, и без
  // хроники после второго круга уже не видно, что человек сдавал в первый
  // раз и что именно его просили доделать.
  const { data: history } = await admin
    .from("item_comments")
    .select("body, system, author_user_id")
    .eq("item_id", taskId)
    .eq("system", true)
    .order("created_at");
  const lines = (history || []).map((h) => h.body);
  check(
    "первый отчёт сохранился, хотя строка отчёта обнулена возвратом",
    lines.some((l) => l.includes("Свёл цифры за август")),
    lines,
  );
  check(
    "возврат на доработку записан вместе с причиной",
    lines.some((l) => l.includes("вернул на доработку") && l.includes("филиалам")),
    lines,
  );
  check("отказ и его причина записаны", lines.some((l) => l.includes("не может") && l.includes("1С")), lines);
  check("приёмка записана", lines.some((l) => l.includes("принял работу")), lines);
  check("у хроники нет автора — её никто не писал", (history || []).every((h) => !h.author_user_id), history);

  const { data: forged } = await mgrA.db
    .from("item_comments")
    .insert({
      user_id: owner.id,
      item_kind: "task",
      item_id: taskId,
      author_user_id: mgrA.id,
      author_assignee_id: personA.id,
      body: "подделка хроники",
      source: "app",
      system: true,
    })
    .select("id");
  check("подделать хронику из браузера нельзя", !forged?.length, forged);

  // ── Права ──────────────────────────────────────────────────────────────
  section("Границы прав");
  const { error: dueError, count: dueCount } = await mgrA.db
    .from("tasks")
    .update({ deadline: later }, { count: "exact" })
    .eq("id", taskId);
  check("исполнитель не может подвинуть срок", !dueError && dueCount === 0, { dueError: dueError?.message, dueCount });

  const reschedule = await post(mgrA, "/api/workspace/report", { action: "reschedule", participantId: partA.id, comment: "Жду данные", date: later });
  check("но может попросить перенос", reschedule.status === 200, reschedule);
  const { data: askRow } = await admin.from("task_participants").select("reschedule_reason, reschedule_to").eq("id", partA.id).maybeSingle();
  check("просьба о переносе видна постановщику", askRow?.reschedule_reason === "Жду данные" && askRow?.reschedule_to === later, askRow);

  // Правила в маршруте и правила в базе должны совпадать. Пока база
  // разрешала руководителю писать в свою строку напрямую, отчёт без единого
  // слова, отказ без причины и задача, не ушедшая на приёмку, отделялись от
  // боевых данных одной строчкой в консоли браузера (миграция 0023).
  const { count: sneak } = await mgrA.db
    .from("task_participants")
    .update({ done_at: new Date().toISOString(), done_comment: null }, { count: "exact" })
    .eq("id", partA.id);
  check("отчитаться мимо маршрута нельзя", sneak === 0, { sneak });

  const { count: sneakVote } = await mgrA.db
    .from("meeting_participants")
    .update({ response: "no", reason: null }, { count: "exact" })
    .eq("user_id", owner.id);
  check("проголосовать мимо маршрута тоже нельзя", sneakVote === 0, { sneakVote });

  // Чужая задача: заведена вторым руководителем на себя, первый её не видит.
  const privateId = randomUUID();
  await admin.from("tasks").insert({ id: privateId, user_id: owner.id, title: "Своё дело Витковского", created_by: mgrB.id, status: "in_progress" });
  await admin.from("task_participants").insert({ user_id: owner.id, task_id: privateId, assignee_id: personB.id, role: "executor" });
  const { data: peek } = await mgrA.db.from("tasks").select("id").eq("id", privateId).maybeSingle();
  check("чужая задача не видна другому руководителю", !peek, peek);
  const { data: ownerPeek } = await owner.db.from("tasks").select("id").eq("id", privateId).maybeSingle();
  check("но владелец видит всё", ownerPeek?.id === privateId, ownerPeek);

  // ── Свой мессенджер ────────────────────────────────────────────────────
  section("Руководитель подключает себе мессенджер");
  const mine = await post(mgrA, "/api/telegram/invite", { assigneeId: personA.id, channel: "telegram" });
  check("руководитель получает код на свой чат", mine.status === 200 && !!mine.body?.code, mine);
  check("и ссылку на бота вместе с ним", typeof mine.body?.link === "string" && mine.body.link.includes(mine.body.code), mine.body);

  const { data: codeRow } = await admin
    .from("telegram_link_codes")
    .select("assignee_id, user_id, channel")
    .eq("code", mine.body?.code || "-")
    .maybeSingle();
  check("код привязан к его строке человека", codeRow?.assignee_id === personA.id, codeRow);
  // Не к нему самому: строка человека живёт в пространстве владельца, и код
  // должен лежать там же — иначе он потеряется для всех, кроме автора.
  check("и к пространству владельца, а не к нему самому", codeRow?.user_id === owner.id, codeRow);

  // Главное ограничение. Правила доступа позволяют руководителю ВИДЕТЬ всех
  // коллег пространства — если бы маршрут этим и ограничился, любой из них
  // выписал бы код на чужое имя и стал получать чужие задачи.
  const notMineChat = await post(mgrA, "/api/telegram/invite", { assigneeId: personB.id, channel: "telegram" });
  check("но не может выписать код на чужое имя", notMineChat.status === 403, notMineChat);

  const ownerIssues = await post(owner, "/api/telegram/invite", { assigneeId: personB.id, channel: "telegram" });
  check("владелец по-прежнему подключает кого угодно", ownerIssues.status === 200 && !!ownerIssues.body?.code, ownerIssues);

  // ── Встреча ────────────────────────────────────────────────────────────
  section("Встреча: голоса и переголосование");
  const meetingId = randomUUID();
  const { error: meetingError } = await owner.db.from("meetings").insert({
    id: meetingId,
    user_id: owner.id,
    title: "Планёрка по марже",
    date: soon,
    time: "10:00",
    status: "planned",
    created_by: owner.id,
  });
  check("владелец создаёт встречу", !meetingError, meetingError?.message);

  const { data: mparts, error: mpError } = await owner.db
    .from("meeting_participants")
    .insert([
      { user_id: owner.id, meeting_id: meetingId, assignee_id: personA.id, role: "participant", response: "none", round: 1 },
      { user_id: owner.id, meeting_id: meetingId, assignee_id: personB.id, role: "participant", response: "none", round: 1 },
    ])
    .select("id, assignee_id");
  check("оба приглашены на встречу", !mpError && mparts?.length === 2, mpError?.message);
  const mpA = mparts.find((p) => p.assignee_id === personA.id);
  const mpB = mparts.find((p) => p.assignee_id === personB.id);

  const yes = await post(mgrA, "/api/workspace/report", { action: "vote", participantId: mpA.id, response: "yes" });
  check("«буду» проходит", yes.status === 200, yes);

  const noWithoutReason = await post(mgrB, "/api/workspace/report", { action: "vote", participantId: mpB.id, response: "no" });
  check("«не смогу» без причины отклоняется", noWithoutReason.status === 400, noWithoutReason);

  const noWithReason = await post(mgrB, "/api/workspace/report", { action: "vote", participantId: mpB.id, response: "no", comment: "Буду в Севастополе" });
  check("«не смогу» с причиной проходит", noWithReason.status === 200, noWithReason);

  const foreignVote = await post(mgrA, "/api/workspace/report", { action: "vote", participantId: mpB.id, response: "yes" });
  check("голосовать за другого нельзя", foreignVote.status === 403, foreignVote);

  // Перенос: дата меняется, круг голосования увеличивается — так это делает
  // трекер (см. useMeetingVotes). «Буду» про вторник ничего не говорит про
  // четверг, поэтому карточка обязана спросить заново.
  await owner.db.from("meetings").update({ date: later, vote_round: 2 }).eq("id", meetingId);
  const { data: votesAfterMove } = await admin.from("meeting_participants").select("response, round").eq("meeting_id", meetingId);
  const stale = (votesAfterMove || []).filter((v) => v.round !== 2 && v.response !== "none");
  check("после переноса прежние голоса не считаются за новый круг", stale.length === 2, votesAfterMove);

  const revote = await post(mgrA, "/api/workspace/report", { action: "vote", participantId: mpA.id, response: "yes" });
  const { data: revoted } = await admin.from("meeting_participants").select("round").eq("id", mpA.id).maybeSingle();
  check("переголосование пишется во второй круг", revote.status === 200 && revoted?.round === 2, revoted);

  // ── Мысль в работу ─────────────────────────────────────────────────────
  section("Мысль → задача");
  const ideaId = randomUUID();
  await owner.db.from("ideas").insert({ id: ideaId, user_id: owner.id, text: "Проверить остатки по складу в Керчи", created_by: owner.id });
  const { data: rec, error: recError } = await owner.db
    .from("idea_recipients")
    .insert({ user_id: owner.id, idea_id: ideaId, assignee_id: personA.id })
    .select("id")
    .maybeSingle();
  check("мысль отправлена человеку", !recError && !!rec?.id, recError?.message);

  const notMine = await post(mgrB, "/api/workspace/report", { action: "take_idea", recipientId: rec.id });
  check("чужую мысль взять нельзя", notMine.status === 403, notMine);

  const take = await post(mgrA, "/api/workspace/report", { action: "take_idea", recipientId: rec.id });
  check("«взять в работу» создаёт задачу", take.status === 200 && !!take.body?.taskId, take);

  const again = await post(mgrA, "/api/workspace/report", { action: "take_idea", recipientId: rec.id });
  check("повторное нажатие не плодит вторую задачу", again.body?.taskId === take.body?.taskId, again.body);

  const { data: fromIdea } = await admin
    .from("task_participants")
    .select("assignee_id, role, accepted_at")
    .eq("task_id", take.body.taskId)
    .maybeSingle();
  check("взявший сразу исполнитель и уже принял", fromIdea?.assignee_id === personA.id && fromIdea?.role === "executor" && !!fromIdea?.accepted_at, fromIdea);

  const { data: ideaTaskSeen } = await mgrA.db.from("tasks").select("id").eq("id", take.body.taskId).maybeSingle();
  check("и видит её у себя", ideaTaskSeen?.id === take.body.taskId, ideaTaskSeen);

  // ── Обсуждение ─────────────────────────────────────────────────────────
  section("Обсуждение внутри задачи");
  const { error: commentError } = await mgrA.db.from("item_comments").insert({
    user_id: owner.id,
    item_kind: "task",
    item_id: taskId,
    author_user_id: mgrA.id,
    author_assignee_id: personA.id,
    body: "Цифры по Керчи подтянул",
    source: "app",
  });
  check("участник пишет в обсуждение", !commentError, commentError?.message);

  const { data: seenByB } = await mgrB.db.from("item_comments").select("body").eq("item_id", taskId).eq("system", false);
  check("второй участник его видит", (seenByB || []).length === 1, seenByB);

  const { data: seenByOwner } = await owner.db.from("item_comments").select("body").eq("item_id", taskId).eq("system", false);
  check("владелец видит обсуждение", (seenByOwner || []).length === 1, seenByOwner);

  const { error: forgeError } = await mgrB.db.from("item_comments").insert({
    user_id: owner.id,
    item_kind: "task",
    item_id: taskId,
    author_user_id: mgrA.id,
    author_assignee_id: personA.id,
    body: "подпись подделана",
    source: "app",
  });
  check("чужим именем писать нельзя", !!forgeError, forgeError?.message);

  const { data: outsiderView } = await mgrA.db.from("item_comments").select("id").eq("item_id", privateId);
  check("обсуждение чужой задачи не видно", (outsiderView || []).length === 0, outsiderView);

  // ── Владелец как получатель ────────────────────────────────────────────
  //
  // Половина паритета, которой не было: руководитель поручает работу
  // ВЛАДЕЛЬЦУ. Его строка в списке людей помечена «(я)», и эта метка
  // означала «строка владельца», а читалась как «этого человека не
  // касается» — задачу ему ставили, а сказать было некому, позвать на
  // встречу нельзя вовсе, и ответ в обсуждении до постановщика не
  // доходил (см. docs/interactions.md).
  section("Владелец как получатель");
  const { data: selfRow, error: selfError } = await owner.db
    .from("assignees")
    .insert({ user_id: owner.id, name: "Тест Владелец (я)" })
    .select("id")
    .single();
  check("у владельца есть своя строка в списке людей", !selfError && !!selfRow?.id, selfError?.message);

  const toOwnerId = randomUUID();
  const { error: toOwnerError } = await mgrA.db.from("tasks").insert({
    id: toOwnerId,
    user_id: owner.id,
    title: "Согласовать смету с банком",
    assignee: "Тест Владелец (я)",
    deadline: soon,
    created_by: mgrA.id,
  });
  check("руководитель ставит задачу владельцу", !toOwnerError, toOwnerError?.message);

  const { data: ownerPart, error: ownerPartError } = await mgrA.db
    .from("task_participants")
    .insert({ user_id: owner.id, task_id: toOwnerId, assignee_id: selfRow.id, role: "executor" })
    .select("id")
    .single();
  check("и ставит его исполнителем", !ownerPartError && !!ownerPart?.id, ownerPartError?.message);

  const ownerAccept = await post(owner, "/api/workspace/report", { action: "accept", participantId: ownerPart.id });
  check("владелец принимает её в работу", ownerAccept.status === 200, ownerAccept);

  const ownerDone = await post(owner, "/api/workspace/report", {
    action: "done",
    participantId: ownerPart.id,
    comment: "Смета согласована",
  });
  check("и отчитывается по ней", ownerDone.status === 200 && ownerDone.body?.awaitingReview === true, ownerDone);

  // Приёмка проходит через ту же рассылку, которая для владельца молчала:
  // важно не только что маршрут отвечает 200, но и что он доходит до
  // конца — сообщение исполнителю ищется теперь через lib/reach.
  const ownerReview = await post(mgrA, "/api/workspace/review", { taskId: toOwnerId, action: "approve", comment: "Принято" });
  check("постановщик принимает работу владельца", ownerReview.status === 200, ownerReview);
  const { data: closedForOwner } = await admin.from("tasks").select("status, approval_state").eq("id", toOwnerId).maybeSingle();
  check("задача закрыта той же записью", closedForOwner?.status === "done" && closedForOwner?.approval_state === "accepted", closedForOwner);

  // Встреча, которой не могло существовать: руководитель зовёт владельца.
  const withOwnerId = randomUUID();
  await mgrA.db.from("meetings").insert({
    id: withOwnerId,
    user_id: owner.id,
    title: "Разбор по смете",
    date: soon,
    time: "15:00",
    status: "planned",
    created_by: mgrA.id,
  });
  const { data: ownerInvite, error: ownerInviteError } = await mgrA.db
    .from("meeting_participants")
    .insert({ user_id: owner.id, meeting_id: withOwnerId, assignee_id: selfRow.id, role: "participant", response: "none", round: 1 })
    .select("id")
    .single();
  check("руководитель зовёт владельца на встречу", !ownerInviteError && !!ownerInvite?.id, ownerInviteError?.message);

  const ownerVote = await post(owner, "/api/workspace/report", { action: "vote", participantId: ownerInvite.id, response: "yes" });
  check("и владелец отвечает «буду»", ownerVote.status === 200, ownerVote);

  // Реплика владельца в задаче руководителя: постановщик не участник
  // собственной задачи, и раньше она не доходила до него ни сразу, ни
  // сводкой — двое переписывались, и один об этом не знал.
  const replyId = randomUUID();
  await owner.db.from("item_comments").insert({
    id: replyId,
    user_id: owner.id,
    item_kind: "task",
    item_id: toOwnerId,
    author_user_id: owner.id,
    author_assignee_id: selfRow.id,
    body: "Банк просит ещё один документ",
    source: "app",
  });
  const told = await post(owner, "/api/workspace/comment", { commentId: replyId });
  check("рассылка реплики проходит", told.status === 200, told);
  const { data: queued } = await admin
    .from("notification_queue")
    .select("kind, to_user")
    .eq("user_id", owner.id)
    .eq("to_user", mgrA.id)
    .eq("kind", "comment");
  check("постановщик узнаёт о реплике в своей задаче", (queued || []).length > 0, queued);

  // ── Переименование человека ────────────────────────────────────────────
  //
  // Имя живёт в двух видах сразу: строка в `assignees` — это человек, а
  // `tasks.assignee` и `meetings.participants` — имя, написанное на
  // карточке. Переименовать одно и забыть другое значит развести их, и
  // тогда задача становится «назначенной только на словах». Поэтому
  // проверяется не ответ маршрута, а то, что имя изменилось ВЕЗДЕ.
  section("Переименование человека");
  // Переименовывается тот, чьё имя стоит в поле «Исполнитель» этой
  // задачи, — иначе проверка «изменилось везде» ничего не проверяет.
  const renamed = await post(owner, "/api/workspace/rename-person", { assigneeId: personA.id, name: "Тест Козлов-Новый" });
  check("владелец переименовывает человека", renamed.status === 200, renamed);

  const { data: afterRename } = await admin.from("assignees").select("name").eq("id", personA.id).maybeSingle();
  check("имя изменилось в списке людей", afterRename?.name === "Тест Козлов-Новый", afterRename);

  const { data: taskAfter } = await admin.from("tasks").select("assignee").eq("id", taskId).maybeSingle();
  check("и на задаче, где это имя было написано", taskAfter?.assignee === "Тест Козлов-Новый", taskAfter);

  const empty = await post(owner, "/api/workspace/rename-person", { assigneeId: personA.id, name: "   " });
  check("пустое имя не проходит", empty.status === 400, empty);

  const foreign = await post(mgrB, "/api/workspace/rename-person", { assigneeId: personA.id, name: "Чужой" });
  check("руководитель переименовать людей не может", foreign.status === 403, foreign);

  const clash = await post(owner, "/api/workspace/rename-person", { assigneeId: personA.id, name: "Тест Витковский" });
  check("двух людей с одним именем не завести", clash.status === 400, clash);

  // Возвращаем как было: дальше идут проверки, которые ищут этого человека
  // по прежнему имени.
  const back = await post(owner, "/api/workspace/rename-person", { assigneeId: personA.id, name: personA.name });
  check("и обратно — имя снова прежнее", back.status === 200, back);

  // ── Отключение доступа ─────────────────────────────────────────────────
  section("Отключение доступа");
  await admin.from("workspace_members").update({ status: "disabled", disabled_at: new Date().toISOString() }).eq("member_id", mgrA.id);
  const afterDisable = await post(mgrA, "/api/workspace/report", { action: "accept", participantId: partA.id });
  check("отключённый не может отчитываться", afterDisable.status === 403, afterDisable);
  const { data: disabledSees } = await mgrA.db.from("tasks").select("id").eq("id", taskId).maybeSingle();
  check("и не видит задачи пространства", !disabledSees, disabledSees);
  const { data: survived } = await admin.from("task_participants").select("id").eq("id", partA.id).maybeSingle();
  check("но его строки остались в базе", !!survived?.id, survived);

  await admin.from("workspace_members").update({ status: "active", disabled_at: null }).eq("member_id", mgrA.id);
  const afterRestore = await post(mgrA, "/api/workspace/report", { action: "accept", participantId: partA.id });
  check("возврат доступа возвращает и работу", afterRestore.status === 200, afterRestore);

  // ── Руководитель со своим трекером ─────────────────────────────────────
  //
  // Кирилл попросил дать коллегам такой же трекер, оставив админское себе.
  // Права на это открыла миграция 0031, и проверяется здесь ровно граница:
  // что теперь можно и что по-прежнему нельзя.
  section("Руководитель со своим трекером");

  // Раздел заводит владелец: у свежего пространства их нет вовсе, и
  // пустой список ничего не сказал бы о правах.
  const sectionId = "sec-ws-" + Date.now();
  const mkSection = await owner.db.from("sections").insert({ id: sectionId, user_id: owner.id, name: "Проверочный", kind: "work", sort_order: 0 });
  check("владелец заводит раздел", !mkSection.error, mkSection.error?.message);

  const { data: ownSections } = await mgrA.db.from("sections").select("id, name").eq("id", sectionId);
  check("руководитель видит разделы пространства", (ownSections || []).length === 1, ownSections);

  const renameTry = await mgrA.db.from("sections").update({ name: "Переименовал" }).eq("id", sectionId).select("id");
  check("но переименовать его не может", (renameTry.data || []).length === 0, renameTry.error?.message);

  const deleteTry = await mgrA.db.from("sections").delete().eq("id", sectionId).select("id");
  check("и удалить не может", (deleteTry.data || []).length === 0, deleteTry.error?.message);

  const badSection = await mgrA.db.from("sections").insert({ id: "sec-mgr-" + Date.now(), user_id: owner.id, name: "Самовольный" });
  check("но завести раздел не может", !!badSection.error, badSection.error?.message);

  const mgrTaskId = "wsmgr" + Date.now().toString(36);
  const mkTask = await mgrA.db.from("tasks").insert({
    id: mgrTaskId,
    user_id: owner.id,
    created_by: mgrA.id,
    title: "Задача от руководителя",
    assignee: "",
    status: "in_progress",
    priority: "med",
    term: "short",
  });
  check("заводит задачу в пространстве владельца", !mkTask.error, mkTask.error?.message);

  const mkPart = await mgrA.db.from("task_participants").insert({ task_id: mgrTaskId, assignee_id: personB.id, role: "executor" });
  check("и ставит на неё исполнителя", !mkPart.error, mkPart.error?.message);

  // Своя — своя, чужая — чужая. Видно ему и ту, где он исполнитель, но
  // дописать туда третьего значит распорядиться чужой работой.
  const intoOthers = await mgrA.db.from("task_participants").insert({ task_id: taskId, assignee_id: personA.id, role: "watcher" });
  check("в чужую задачу человека не вписывает", !!intoOthers.error, intoOthers.error?.message);

  const { data: mgrTaskSeen } = await mgrB.db.from("tasks").select("id").eq("id", mgrTaskId).maybeSingle();
  check("исполнитель видит поставленную ему задачу", mgrTaskSeen?.id === mgrTaskId, mgrTaskSeen);

  const stealTitle = await mgrB.db.from("tasks").update({ title: "Переписал" }).eq("id", mgrTaskId).select("id");
  check("но переписать её не может", (stealTitle.data || []).length === 0, stealTitle.error?.message);

  // ── Принудительное закрытие ────────────────────────────────────────────
  section("Принудительное закрытие");
  const stuckId = randomUUID();
  await owner.db.from("tasks").insert({ id: stuckId, user_id: owner.id, title: "Ничья задача", status: "in_progress", created_by: owner.id });
  await owner.db.from("task_participants").insert({ user_id: owner.id, task_id: stuckId, assignee_id: personB.id, role: "executor" });
  const forceNoReason = await post(owner, "/api/workspace/review", { action: "force", taskId: stuckId });
  check("закрыть волевым без причины нельзя", forceNoReason.status === 400, forceNoReason);
  const forced = await post(owner, "/api/workspace/review", { action: "force", taskId: stuckId, comment: "Потеряло смысл" });
  check("закрытие волевым проходит", forced.status === 200, forced);
  const { data: forcedRow } = await admin.from("tasks").select("approval_state, force_closed_by, force_closed_reason, status").eq("id", stuckId).maybeSingle();
  check("и отмечено как волевое", forcedRow?.approval_state === "accepted" && !!forcedRow?.force_closed_by && !!forcedRow?.force_closed_reason, forcedRow);
  check("закрытая волевым — тоже закрыта", forcedRow?.status === "done", forcedRow);

  // ── Выход из «Завершённых» ─────────────────────────────────────────────
  //
  // Доска ходит только вперёд, значит из закрытой задачи выход один —
  // кнопка в карточке, то есть этот маршрут. Закрытой задачу делают ДВА
  // поля сразу, и снятие одного оставляло её в «Завершённых» при снятой
  // галочке: состояние, из которого нет выхода ни мышью, ни кнопкой.
  const reopenAlien = await post(mgrB, "/api/workspace/review", { action: "reopen", taskId: stuckId });
  check("чужую закрытую задачу заново не откроешь", reopenAlien.status === 403, reopenAlien);

  const reopened = await post(owner, "/api/workspace/review", { action: "reopen", taskId: stuckId, comment: "Снова нужно" });
  check("постановщик открывает задачу заново", reopened.status === 200, reopened);
  const { data: reopenedRow } = await admin
    .from("tasks")
    .select("status, approval_state, approved_at, completed_at, force_closed_by, force_closed_reason")
    .eq("id", stuckId)
    .maybeSingle();
  check(
    "снято всё, что задачу закрывало",
    reopenedRow?.status === "in_progress" &&
      reopenedRow?.approval_state === "open" &&
      !reopenedRow?.approved_at &&
      !reopenedRow?.completed_at &&
      !reopenedRow?.force_closed_by &&
      !reopenedRow?.force_closed_reason,
    reopenedRow,
  );
  const { data: reopenLine } = await admin
    .from("item_comments")
    .select("body")
    .eq("item_id", stuckId)
    .eq("system", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Имя, а не роль: «Постановщик открыл заново» не отвечает на вопрос,
  // который к этой строке задают, когда постановщиков четырнадцать.
  check("и записано в хронику именем того, кто это сделал", (reopenLine?.body || "").includes("открыл задачу заново"), reopenLine);

  // ── Потерянный доступ ──────────────────────────────────────────────────
  //
  // «Как дать ссылку повторно, если предыдущая утеряна» — вопрос Кирилла от
  // 19.09.2026, и до того дня ответа на него не было: приглашение вошедшему
  // отвечает 409 (иначе человек завёл бы себе второй аккаунт мимо своих же
  // задач), а рядом со строкой «в трекере» не было ни одной кнопки. Здесь
  // проверяется второй маршрут — тот, что выдаёт ссылку на новый пароль для
  // ТОГО ЖЕ входа, — и главное в нём: что ссылка ведёт на адрес трекера и
  // что по ней действительно можно сменить пароль и войти.
  section("Потерянный доступ");

  const lost = await post(owner, "/api/workspace/access-link", { assigneeId: personA.id });
  check("владелец получает ссылку для вошедшего", lost.status === 200 && !!lost.body?.link, lost);
  check("вместе с почтой, под которой человек входит", lost.body?.email === emailA, lost.body?.email);
  check(
    "ссылка ведёт на трекер, а не на supabase.co",
    typeof lost.body?.link === "string" && lost.body.link.startsWith(base + "/reset-password?token_hash="),
    lost.body?.link,
  );

  // Человек, у которого входа нет вовсе: ему нужна не эта ссылка, а обычное
  // приглашение, и маршрут говорит именно это.
  const { data: personC } = await owner.db.from("assignees").insert({ user_id: owner.id, name: "Тест Безлогинов" }).select("id").single();
  const noLogin = await post(owner, "/api/workspace/access-link", { assigneeId: personC.id });
  check("человеку без входа ссылка не выдаётся", noLogin.status === 409, noLogin);

  // Выдавать доступ — право владельца. Руководитель видит людей
  // пространства, и без явной проверки маршрут выдал бы ссылку любому.
  const mgrTries = await post(mgrB, "/api/workspace/access-link", { assigneeId: personA.id });
  check("руководитель ссылку на чужой вход не получает", mgrTries.status !== 200, mgrTries);

  // Ссылка проверяется тем же способом, каким её открывает человек:
  // одноразовый код меняется на сессию, сессией задаётся новый пароль.
  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const tokenHash = decodeURIComponent(new URL(lost.body.link).searchParams.get("token_hash") || "");
  const { error: otpError } = await anon.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  check("код из ссылки меняется на сессию", !otpError, otpError?.message);
  const newPass = "Ws-" + randomUUID().slice(0, 12) + "!Bb2";
  const { error: setError } = await anon.auth.updateUser({ password: newPass });
  check("по ней задаётся новый пароль", !setError, setError?.message);
  const relogin = await createClient(url, anonKey, { auth: { persistSession: false } }).auth.signInWithPassword({
    email: emailA,
    password: newPass,
  });
  check("с новым паролем вход проходит", !relogin.error && relogin.data?.user?.id === mgrA.id, relogin.error?.message);

  const spent = await anon.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  check("и второй раз та же ссылка не срабатывает", !!spent.error, spent.error?.message);

  // «Забыли пароль?»: ответ обязан быть одинаковым, что бы ни нашлось, —
  // иначе по нему перебирают, кто в трекере есть.
  const unknown = await post(null, "/api/workspace/forgot-password", { email: `нет-такой-${Date.now()}@example.invalid` });
  const known = await post(null, "/api/workspace/forgot-password", { email: emailA });
  check("«забыли пароль» отвечает 200 незнакомой почте", unknown.status === 200 && unknown.body?.ok === true, unknown);
  check("и ровно то же самое — знакомой", known.status === 200 && known.body?.message === unknown.body?.message, known);
  check("без почты — отказ", (await post(null, "/api/workspace/forgot-password", {})).status === 400);
} catch (e) {
  console.error("\nСценарий оборвался:", e.message);
  failures++;
} finally {
  await cleanup();
}

console.log(`\n${failures ? `ПРОВАЛЕНО: ${failures} из ${checks}` : `ALL PASSED (${checks})`}`);
process.exit(failures ? 1 : 0);
