// Десять человек в одном трекере — так, как он работает на самом деле.
//
// `test:workspace` проверяет правила на троих: владелец и два руководителя,
// почти всё поручает владелец. Но трекер давно не про это: с 20.09.2026
// поручают все всем, с 23.09.2026 каждый видит только своё, и ошибки
// этого вида живут ровно там, где людей больше трёх и работу ставит не
// владелец. Аудит 20.10.2026 (просьба Кирилла: «на базе десяти тестовых
// аккаунтов, создавая и поочерёдно завершая встречи и задачи… отправку,
// пересылку и прочие манипуляции с мыслями») — этот файл.
//
// Что здесь проходит:
// — кольцо поручений: каждый из десяти ставит задачу следующему, и каждая
//   закрывается своим путём (приёмка, возврат, отказ и принудительное
//   закрытие, просьба о переносе, открытие заново);
// — задача на пятерых с ролями: «сделал всю задачу», наблюдатель, посторонний;
// — десять встреч, у каждой свой организатор и трое приглашённых: голоса,
//   занятость, итог, провал, отмена и перенос;
// — мысли: отправить, поделиться, принять, сохранить копию и переслать её
//   дальше, взять в работу, превратить в задачу коллеге и во встречу;
// — и в конце — главное: каждый из десяти видит ровно своё, ни строкой
//   больше, во всех таблицах сразу.
//
// Безопасно против продакшна по той же причине, что и test:workspace:
// все учётные записи одноразовые, мессенджеров у них нет, и за собой
// прогон удаляет всё.
//
//   npm run test:ten
//   npm run test:ten -- http://localhost:3100
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
const failed = [];
function check(name, ok, detail) {
  checks++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)?.slice(0, 400)}`);
  if (!ok) {
    failures++;
    failed.push(name);
  }
}
function section(title) {
  console.log("\n" + title);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const soon = day(7);
const later = day(14);
const tomorrow = day(1);

// Десять имён в формате «Имя Фамилия» — как их пишет трекер.
const NAMES = [
  "Аудит Владелец (я)",
  "Анна Аудитова",
  "Борис Аудитов",
  "Вера Аудитова",
  "Глеб Аудитов",
  "Дина Аудитова",
  "Егор Аудитов",
  "Жанна Аудитова",
  "Зиновий Аудитов",
  "Ирина Аудитова",
];

try {
  // ── Подготовка ─────────────────────────────────────────────────────────
  section("Десять человек: приглашение и вход");
  const ownerEmail = `tenaudit-owner-${Date.now()}@example.invalid`;
  const ownerPass = "Ten-" + randomUUID().slice(0, 12) + "!Aa1";
  const { data: ownerUser, error: ownerErr } = await admin.auth.admin.createUser({ email: ownerEmail, password: ownerPass, email_confirm: true });
  if (ownerErr) throw ownerErr;
  created.push(ownerUser.user.id);
  const owner = await signIn(ownerEmail, ownerPass);
  const space = owner.id;

  const { data: people, error: peopleErr } = await owner.db
    .from("assignees")
    .insert(NAMES.map((name) => ({ user_id: space, name })))
    .select("id, name");
  check("владелец заводит себя и девятерых", !peopleErr && people?.length === 10, peopleErr?.message);
  if (!people || people.length !== 10) throw new Error("без людей дальше нечего проверять");
  const person = NAMES.map((n) => people.find((p) => p.name === n));

  // u[i] — участник с индексом i: сессия, его строка в списке людей, имя.
  const u = [{ ...owner, row: person[0], name: NAMES[0] }];
  for (let i = 1; i < 10; i++) {
    const inv = await post(owner, "/api/workspace/invite", { assigneeId: person[i].id });
    const email = `tenaudit-${i}-${Date.now()}@example.invalid`;
    const pass = "Ten-" + randomUUID().slice(0, 12) + "!Aa1";
    const join = await post(null, "/api/workspace/join", { code: inv.body?.code, email, password: pass });
    if (join.status !== 200) {
      check(`${NAMES[i]} заводит вход`, false, join);
      throw new Error("без входа дальше нечего проверять");
    }
    const s = await signIn(email, pass);
    created.push(s.id);
    u.push({ ...s, row: person[i], name: NAMES[i] });
  }
  check("все девять вошли по приглашению", u.length === 10);

  // Как пишет задачу браузер: строка пространства (user_id владельца),
  // автор — тот, кто поручает (у владельца created_by пуст: так его строки
  // и отличаются), исполнители — строками участия, upsert'ом, потому что
  // первого уже завёл триггер по имени в поле (миграция 0024).
  async function makeTask(by, { title, executors, coexecutors = [], watchers = [], deadline = soon }) {
    const id = randomUUID();
    const row = {
      id,
      user_id: space,
      title,
      description: "",
      assignee: executors[0].name,
      priority: "med",
      term: "short",
      status: "in_progress",
      deadline,
      ...(by.id === space ? {} : { created_by: by.id }),
    };
    const { error } = await by.db.from("tasks").insert(row);
    if (error) return { id, error: error.message };
    const parts = [
      ...executors.map((p) => ({ user_id: space, task_id: id, assignee_id: p.row.id, role: "executor" })),
      ...coexecutors.map((p) => ({ user_id: space, task_id: id, assignee_id: p.row.id, role: "coexecutor" })),
      ...watchers.map((p) => ({ user_id: space, task_id: id, assignee_id: p.row.id, role: "watcher" })),
    ];
    const { error: pErr } = await by.db.from("task_participants").upsert(parts, { onConflict: "task_id,assignee_id", ignoreDuplicates: true });
    return { id, error: pErr?.message || null };
  }
  async function partOf(taskId, who) {
    const { data } = await admin.from("task_participants").select("id").eq("task_id", taskId).eq("assignee_id", who.row.id).maybeSingle();
    return data?.id;
  }
  async function taskRow(id) {
    return (await admin.from("tasks").select("status, approval_state, approval_comment, completed_at, deadline, created_by").eq("id", id).maybeSingle()).data;
  }

  // Что каждый ДОЛЖЕН видеть — накапливается по ходу и сверяется в конце.
  const expect = { tasks: NAMES.map(() => new Set()), meetings: NAMES.map(() => new Set()), ideas: NAMES.map(() => new Set()) };
  const allTasks = new Set();
  const allMeetings = new Set();
  const allIdeas = new Set();
  const seeTask = (id, ...who) => {
    allTasks.add(id);
    for (const w of who) expect.tasks[u.indexOf(w)].add(id);
  };

  // ── Кольцо поручений ────────────────────────────────────────────────────
  section("Кольцо: каждый поручает следующему");
  const ring = [];
  for (let i = 0; i < 10; i++) {
    const by = u[i];
    const to = u[(i + 1) % 10];
    const t = await makeTask(by, { title: `Кольцо ${i}: от ${by.name} для ${to.name}`, executors: [to] });
    check(`${by.name} поручает ${to.name}`, !t.error, t.error);
    seeTask(t.id, by, to);
    ring.push({ id: t.id, by, to });
  }
  for (const t of ring) {
    const { data: parts } = await admin.from("task_participants").select("assignee_id, role").eq("task_id", t.id);
    if ((parts || []).length !== 1 || parts[0].assignee_id !== t.to.row.id) check(`у задачи «${t.id.slice(0, 6)}» ровно один исполнитель`, false, parts);
  }
  check("у каждой задачи кольца ровно один исполнитель — без дублей от триггера", true);

  // Номер ставит база, и у десяти задач он разный.
  const { data: nums } = await admin.from("tasks").select("number").in("id", ring.map((t) => t.id));
  const numSet = new Set((nums || []).map((n) => n.number));
  check("десять задач — десять разных номеров", numSet.size === 10 && ![...numSet].includes(null), nums);

  // Посторонний — тот, кто через одного: ни постановщик, ни исполнитель.
  for (const t of ring) {
    const stranger = u[(u.indexOf(t.to) + 1) % 10];
    const { data } = await stranger.db.from("tasks").select("id").eq("id", t.id);
    if ((data || []).length) check(`${stranger.name} не видит чужую задачу ${t.by.name} → ${t.to.name}`, false, data);
  }
  check("никто не видит задачу, к которой не причастен", true);

  section("Кольцо: каждая задача закрывается своим путём");
  for (let i = 0; i < 10; i++) {
    const t = ring[i];
    const part = await partOf(t.id, t.to);
    const path = i % 5;
    const outsider = u[(i + 5) % 10];

    const accept = await post(t.to, "/api/workspace/report", { action: "accept", participantId: part });
    if (accept.status !== 200) check(`«принял» ${t.to.name}`, false, accept);

    if (path === 0) {
      // Обычный путь: сделал → принято.
      const done = await post(t.to, "/api/workspace/report", { action: "done", participantId: part, comment: "Готово" });
      check(`[${i}] «сделал» уводит на приёмку`, done.status === 200 && done.body?.awaitingReview === true, done);
      const foreign = await post(outsider, "/api/workspace/review", { action: "approve", taskId: t.id, comment: "чужое" });
      check(`[${i}] посторонний не принимает чужую работу`, foreign.status === 403 || foreign.status === 404, foreign);
      const self = await post(t.to, "/api/workspace/review", { action: "approve", taskId: t.id, comment: "сам себе" });
      check(`[${i}] исполнитель не принимает свою работу`, self.status === 403, self);
      const ok = await post(t.by, "/api/workspace/review", { action: "approve", taskId: t.id, comment: "Принято" });
      const row = await taskRow(t.id);
      check(`[${i}] постановщик ${t.by.name} принимает — задача закрыта`, ok.status === 200 && row?.status === "done" && row?.approval_state === "accepted", { ok, row });
    } else if (path === 1) {
      // Возврат на доработку и вторая сдача.
      await post(t.to, "/api/workspace/report", { action: "done", participantId: part, comment: "Первая версия" });
      const ret = await post(t.by, "/api/workspace/review", { action: "return", taskId: t.id, comment: "Не хватает цифр" });
      const back = await taskRow(t.id);
      check(`[${i}] возврат на доработку`, ret.status === 200 && back?.approval_state === "returned", { ret, back });
      const again = await post(t.to, "/api/workspace/report", { action: "done", participantId: part, comment: "Добавил цифры" });
      check(`[${i}] вторая сдача снова на приёмке`, again.body?.awaitingReview === true, again);
      const ok = await post(t.by, "/api/workspace/review", { action: "approve", taskId: t.id, comment: "Теперь да" });
      check(`[${i}] принято со второго раза`, ok.status === 200 && (await taskRow(t.id))?.status === "done", ok);
    } else if (path === 2) {
      // Отказ → на приёмке → принудительное закрытие.
      const dec = await post(t.to, "/api/workspace/report", { action: "decline", participantId: part, comment: "Нет доступа" });
      check(`[${i}] отказ уводит на приёмку`, dec.status === 200 && dec.body?.awaitingReview === true, dec);
      const approveDeclined = await post(t.by, "/api/workspace/review", { action: "approve", taskId: t.id, comment: "?" });
      check(`[${i}] принять нечего, когда все отказались`, approveDeclined.status >= 400, approveDeclined);
      const noWhy = await post(t.by, "/api/workspace/review", { action: "force", taskId: t.id });
      check(`[${i}] принудительное закрытие без слов не проходит`, noWhy.status === 400, noWhy);
      const force = await post(t.by, "/api/workspace/review", { action: "force", taskId: t.id, comment: "Неактуально" });
      check(`[${i}] принудительное закрытие`, force.status === 200 && (await taskRow(t.id))?.status === "done", force);
    } else if (path === 3) {
      // Просьба о переносе → постановщик переносит → сдача → приёмка.
      const ask = await post(t.to, "/api/workspace/report", { action: "reschedule", participantId: part, comment: "Жду поставщика", date: later });
      check(`[${i}] просьба о переносе`, ask.status === 200, ask);
      const notAuthor = await post(outsider, "/api/workspace/review", { action: "moved", taskId: t.id, participantId: part, date: later });
      check(`[${i}] решать о переносе может только постановщик`, notAuthor.status === 403 || notAuthor.status === 404, notAuthor);
      // Сам срок двигает движок синхронизации — то есть клиент автора.
      const { error: moveErr } = await t.by.db.from("tasks").update({ deadline: later }).eq("id", t.id);
      const moved = await post(t.by, "/api/workspace/review", { action: "moved", taskId: t.id, participantId: part, date: later });
      const { data: pr } = await admin.from("task_participants").select("reschedule_to").eq("id", part).maybeSingle();
      check(`[${i}] срок перенесён, просьба закрыта`, !moveErr && moved.status === 200 && !pr?.reschedule_to && (await taskRow(t.id))?.deadline === later, { moveErr, moved, pr });
      // Исполнитель срок своей задачи двигать не может: строка не его.
      const { data: sneak } = await t.to.db.from("tasks").update({ deadline: day(60) }).eq("id", t.id).select("id");
      check(`[${i}] исполнитель срок не двигает`, !(sneak || []).length, sneak);
      await post(t.to, "/api/workspace/report", { action: "done", participantId: part, comment: "Сделано к новому сроку" });
      const ok = await post(t.by, "/api/workspace/review", { action: "approve", taskId: t.id, comment: "Ок" });
      check(`[${i}] принято после переноса`, ok.status === 200, ok);
    } else {
      // Принято → открыто заново → снова принято.
      await post(t.to, "/api/workspace/report", { action: "done", participantId: part, comment: "Сделал" });
      await post(t.by, "/api/workspace/review", { action: "approve", taskId: t.id, comment: "Ок" });
      const late = await post(t.to, "/api/workspace/report", { action: "decline", participantId: part, comment: "Передумал" });
      check(`[${i}] после закрытия исполнитель ответ не меняет`, late.status >= 400, late);
      const reopen = await post(t.by, "/api/workspace/review", { action: "reopen", taskId: t.id, comment: "Закрыл не то" });
      const r = await taskRow(t.id);
      // Открытие заново отчётов не стирает — по ним доска и ставит задачу
      // обратно в «На приёмке» (lib/kanban), без отдельного состояния.
      const { data: kept } = await admin.from("task_participants").select("done_at").eq("id", part).maybeSingle();
      check(`[${i}] открыта заново, отчёт сохранён — снова на приёмке`, reopen.status === 200 && r?.status !== "done" && !!kept?.done_at, { reopen, r, kept });
      const ok = await post(t.by, "/api/workspace/review", { action: "approve", taskId: t.id, comment: "Теперь закрываю верно" });
      check(`[${i}] и снова принята`, ok.status === 200 && (await taskRow(t.id))?.status === "done", ok);
    }
  }

  // Закрытое — только просмотр (миграция 0056): писать в обсуждение закрытой
  // задачи не может ни постановщик, ни исполнитель.
  {
    const t = ring[0];
    const { error } = await t.to.db.from("item_comments").insert({
      user_id: space, item_kind: "task", item_id: t.id, author_user_id: t.to.id, author_assignee_id: t.to.row.id, body: "после закрытия", source: "app",
    });
    check("в обсуждение закрытой задачи не пишут", !!error, error?.message);
  }

  // Хроника: у каждой задачи кольца есть строки о её пути.
  {
    const { data: sys } = await admin.from("item_comments").select("item_id").eq("system", true).in("item_id", ring.map((t) => t.id));
    const withHistory = new Set((sys || []).map((s) => s.item_id));
    check("у каждой из десяти задач есть хроника", withHistory.size === 10, { withHistory: withHistory.size });
  }

  // ── Задача на пятерых ──────────────────────────────────────────────────
  section("Задача на пятерых: два исполнителя, соисполнитель, наблюдатель");
  const [boss, ex1, ex2, co, watch, outsiderM] = [u[3], u[4], u[5], u[6], u[7], u[8]];
  const big = await makeTask(boss, { title: "Большая задача на команду", executors: [ex1, ex2], coexecutors: [co], watchers: [watch] });
  check(`${boss.name} ставит задачу на четверых`, !big.error, big.error);
  seeTask(big.id, boss, ex1, ex2, co, watch);
  {
    const { data: parts } = await admin.from("task_participants").select("role").eq("task_id", big.id);
    check("четыре строки участия, роли на месте", (parts || []).length === 4, parts);
    const { data: hidden } = await outsiderM.db.from("tasks").select("id").eq("id", big.id);
    check("посторонний её не видит", !(hidden || []).length, hidden);
    const watcherPart = await partOf(big.id, watch);
    const wDone = await post(watch, "/api/workspace/report", { action: "done", participantId: watcherPart, comment: "я тоже" });
    check("наблюдатель не отчитывается", wDone.status >= 400, wDone);
    const p1 = await partOf(big.id, ex1);
    const p2 = await partOf(big.id, ex2);
    await post(ex1, "/api/workspace/report", { action: "accept", participantId: p1 });
    const whole = await post(ex1, "/api/workspace/report", { action: "done", participantId: p1, comment: "Сделал всё за обоих", whole: true });
    check("«сделал всю задачу» уводит на приёмку сразу", whole.status === 200 && whole.body?.awaitingReview === true, whole);
    const lateAnswer = await post(ex2, "/api/workspace/report", { action: "decline", participantId: p2, comment: "не успел" });
    check("на приёмке второй исполнитель уже ничего не меняет", lateAnswer.status >= 400, lateAnswer);
    const { error: talk } = await ex2.db.from("item_comments").insert({
      user_id: space, item_kind: "task", item_id: big.id, author_user_id: ex2.id, author_assignee_id: ex2.row.id, body: "Я тоже посмотрел", source: "app",
    });
    check("но писать в обсуждение на приёмке может", !talk, talk?.message);
    const { data: wSees } = await watch.db.from("item_comments").select("body").eq("item_id", big.id).eq("system", false);
    check("наблюдатель видит обсуждение", (wSees || []).length === 1, wSees);
    const { data: oSees } = await outsiderM.db.from("item_comments").select("id").eq("item_id", big.id);
    check("посторонний не видит ни строки обсуждения", !(oSees || []).length, oSees);
    const ok = await post(boss, "/api/workspace/review", { action: "approve", taskId: big.id, comment: "Принято" });
    check("постановщик принимает задачу на команду", ok.status === 200 && (await taskRow(big.id))?.status === "done", ok);
  }

  // ── Задача №111: работа у каждого своя ─────────────────────────────────
  // 21.10.2026: шестеро изучали книгу, один нажал «сдал целиком» за всех,
  // а возврат снимал отчёты у каждого. Теперь — «дождаться всех» и возврат
  // выбранным, и чужие отчёты при этом не трогаются.
  section("Групповая задача: «дождаться всех» и возврат одному");
  {
    const [lead, e1, e2, e3] = [u[9], u[0], u[1], u[2]];
    const g = await makeTask(lead, { title: "Каждый читает книгу сам", executors: [e1, e2, e3] });
    check(`${lead.name} ставит задачу на троих`, !g.error, g.error);
    seeTask(g.id, lead, e1, e2, e3);
    const [q1, q2, q3] = [await partOf(g.id, e1), await partOf(g.id, e2), await partOf(g.id, e3)];
    const doneAt = async (p) => (await admin.from("task_participants").select("done_at").eq("id", p).maybeSingle()).data?.done_at;
    await post(e1, "/api/workspace/report", { action: "done", participantId: q1, comment: "Прочитал свою часть" });
    const whole = await post(e2, "/api/workspace/report", { action: "done", participantId: q2, comment: "Сдаю целиком", whole: true });
    check("«сдал целиком» уводит на приёмку", whole.body?.awaitingReview === true, whole);
    const wait = await post(lead, "/api/workspace/review", { action: "wait", taskId: g.id });
    const afterWait = await taskRow(g.id);
    check("«дождаться всех» снимает приёмку", wait.status === 200 && afterWait?.approval_state === "open", { wait, afterWait });
    check("и не трогает ничьих отчётов", !!(await doneAt(q1)) && !!(await doneAt(q2)));
    const foreignWait = await post(e1, "/api/workspace/review", { action: "wait", taskId: g.id });
    check("исполнитель «дождаться всех» не нажимает", foreignWait.status === 403, foreignWait);
    const last = await post(e3, "/api/workspace/report", { action: "done", participantId: q3, comment: "И я прочитал" });
    check("ответил последний — задача снова на приёмке сама", last.body?.awaitingReview === true, last);
    const notAnswered = await post(lead, "/api/workspace/review", { action: "return", taskId: g.id, comment: "x", participantIds: [randomUUID()] });
    check("вернуть чужому этой задачи нельзя", notAnswered.status >= 400, notAnswered);
    const ret = await post(lead, "/api/workspace/review", { action: "return", taskId: g.id, comment: "Сделано не полностью", participantIds: [q2] });
    const afterRet = await taskRow(g.id);
    check("возврат одному проходит", ret.status === 200 && afterRet?.approval_state === "returned", { ret, afterRet });
    check("отчёт вернувшегося снят", !(await doneAt(q2)));
    check("отчёты остальных остались", !!(await doneAt(q1)) && !!(await doneAt(q3)));
    check("плашка называет, кому вернули", String(afterRet?.approval_comment || "").startsWith(e2.name.replace(/\s*\(я\)\s*$/, "")), afterRet?.approval_comment);
    const again = await post(e2, "/api/workspace/report", { action: "done", participantId: q2, comment: "Доделал" });
    check("вернувшийся доделал — снова на приёмке, остальные ничего не нажимали", again.body?.awaitingReview === true, again);
    const ok = await post(lead, "/api/workspace/review", { action: "approve", taskId: g.id, comment: "Все прочитали" });
    check("и принята", ok.status === 200 && (await taskRow(g.id))?.status === "done", ok);
  }

  // ── Встречи ─────────────────────────────────────────────────────────────
  section("Десять встреч: каждый собирает троих");
  // Время у всех разное (10:00, 10:30 …), день один — так видно, что
  // занятость считается по людям, а не по дню.
  const meetings = [];
  for (let i = 0; i < 10; i++) {
    const org = u[i];
    const guests = [u[(i + 1) % 10], u[(i + 2) % 10], u[(i + 3) % 10]];
    const id = randomUUID();
    const time = `${String(10 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
    const { error } = await org.db.from("meetings").insert({
      id,
      user_id: space,
      title: `Встреча ${i} у ${org.name}`,
      date: soon,
      time,
      duration_min: 30,
      participants: guests.map((g) => g.name),
      status: "planned",
      ...(org.id === space ? {} : { created_by: org.id }),
    });
    const rows = [org, ...guests].map((p) => ({ user_id: space, meeting_id: id, assignee_id: p.row.id, role: p === org ? "organizer" : "participant", response: p === org ? "yes" : "none", round: 1 }));
    const { error: pErr } = await org.db.from("meeting_participants").upsert(rows, { onConflict: "meeting_id,assignee_id", ignoreDuplicates: true });
    check(`${org.name} собирает встречу на ${time}`, !error && !pErr, error?.message || pErr?.message);
    allMeetings.add(id);
    for (const p of [org, ...guests]) expect.meetings[u.indexOf(p)].add(id);
    meetings.push({ id, org, guests, time });
  }
  {
    const { data: mp } = await admin.from("meeting_participants").select("meeting_id").in("meeting_id", meetings.map((m) => m.id));
    check("у каждой встречи четыре строки состава — триггер не задвоил", (mp || []).length === 40, { rows: (mp || []).length });
  }

  section("Встречи: голоса");
  for (const [i, m] of meetings.entries()) {
    const [g1, g2, g3] = m.guests;
    const part = async (g) => (await admin.from("meeting_participants").select("id").eq("meeting_id", m.id).eq("assignee_id", g.row.id).maybeSingle()).data?.id;
    const yes = await post(g1, "/api/workspace/report", { action: "vote", participantId: await part(g1), response: "yes" });
    const late = await post(g2, "/api/workspace/report", { action: "vote", participantId: await part(g2), response: "late" });
    const no = await post(g3, "/api/workspace/report", { action: "vote", participantId: await part(g3), response: "no", comment: "В отъезде" });
    if ([yes, late, no].some((r) => r.status !== 200)) check(`[${i}] голоса проходят`, false, { yes, late, no });
    const forged = await post(g1, "/api/workspace/report", { action: "vote", participantId: await part(g2), response: "no", comment: "за него" });
    if (forged.status !== 403) check(`[${i}] за другого не голосуют`, false, forged);
  }
  check("тридцать голосов прошли, подделанные отклонены", true);

  // Занятость (busy_slots): организатор знает, кто занят, но не чем.
  {
    // Встречу 0 (гости — Анна, Борис, Вера) Егор не видит, но её время
    // обязано гаснуть у него в форме: Анна занята в 10:00.
    const { data: busy, error } = await u[6].db.rpc("busy_slots");
    const flat = JSON.stringify(busy || []);
    check("занятость отвечает", !error && Array.isArray(busy), error?.message);
    check("чужая встреча видна в занятости временем и людьми", (busy || []).some((b) => b.person === u[1].name && b.date === soon && b.time === "10:00"), busy?.slice?.(0, 5));
    check("в занятости нет названий чужих встреч", !flat.includes("Встреча 0 у"), busy?.slice?.(0, 3));
  }

  section("Встречи: участник не распоряжается чужой встречей");
  {
    const m = meetings[2];
    const g = m.guests[0];
    const { data: moved } = await g.db.from("meetings").update({ time: "18:00" }).eq("id", m.id).select("id");
    check("участник не меняет время чужой встречи", !(moved || []).length, moved);
    const rec = await post(g, "/api/workspace/recap", { meetingId: m.id, result: "Решили всё", outcome: "success" });
    check("участник не пишет итог чужой встречи", rec.status === 403, rec);
    const cancel = await post(g, "/api/workspace/meeting-cancel", { meetingId: m.id, reason: "надоело" });
    check("участник не отменяет чужую встречу", cancel.status === 403 || cancel.status === 404, cancel);
    const stranger = u[(u.indexOf(m.org) + 5) % 10];
    const { data: seen } = await stranger.db.from("meetings").select("id").eq("id", m.id);
    check("посторонний её не видит", !(seen || []).length, seen);
  }

  section("Встречи: поочерёдно закрываются");
  for (const [i, m] of meetings.entries()) {
    const path = i % 4;
    if (path === 0 || path === 1) {
      const outcome = path === 0 ? "success" : "no_result";
      const result = path === 0 ? "Договорились о сроках" : "Не договорились";
      const { error } = await m.org.db.from("meetings").update({ status: outcome, result, resolved_at: new Date().toISOString() }).eq("id", m.id);
      const rec = await post(m.org, "/api/workspace/recap", { meetingId: m.id, result, outcome });
      check(`[${i}] ${outcome === "success" ? "успех" : "провал"} у ${m.org.name}`, !error && rec.status === 200, { error: error?.message, rec });
      const { data: line } = await admin.from("item_comments").select("body").eq("item_id", m.id).eq("system", true);
      if (!(line || []).length) check(`[${i}] итог оставил строку в обсуждении`, false, line);
    } else if (path === 2) {
      const noWhy = await post(m.org, "/api/workspace/meeting-cancel", { meetingId: m.id });
      // Встречу снимает вкладка (мягкое удаление движком синхронизации),
      // маршрут только пишет хронику и говорит людям.
      const { data: guestDel } = await m.guests[0].db.from("meetings").update({ deleted_at: new Date().toISOString() }).eq("id", m.id).select("id");
      if ((guestDel || []).length) check(`[${i}] гость не удаляет чужую встречу`, false, guestDel);
      await m.org.db.from("meetings").update({ deleted_at: new Date().toISOString() }).eq("id", m.id);
      const cancel = await post(m.org, "/api/workspace/meeting-cancel", { meetingId: m.id, reason: "Перенесли на месяц" });
      const { data: row } = await admin.from("meetings").select("deleted_at, status").eq("id", m.id).maybeSingle();
      check(`[${i}] отмена: без причины нельзя, с причиной — встреча снята`, noWhy.status === 400 && cancel.status === 200 && (!!row?.deleted_at || row?.status === "cancelled"), { noWhy, cancel, row });
      expect.meetings.forEach((s) => s.delete(m.id));
      allMeetings.delete(m.id);
    } else {
      // Перенос — новая встреча с тем же составом, прежняя закрыта как
      // перенесённая (closeAsMoved), маршрут пишет хронику.
      const toId = randomUUID();
      const { error } = await m.org.db.from("meetings").insert({
        id: toId, user_id: space, title: `Встреча ${i} (перенос)`, date: later, time: m.time, duration_min: 30,
        participants: m.guests.map((g) => g.name), status: "planned", ...(m.org.id === space ? {} : { created_by: m.org.id }),
      });
      await m.org.db.from("meeting_participants").upsert(
        [m.org, ...m.guests].map((p) => ({ user_id: space, meeting_id: toId, assignee_id: p.row.id, role: p === m.org ? "organizer" : "participant", response: p === m.org ? "yes" : "none", round: 1 })),
        { onConflict: "meeting_id,assignee_id", ignoreDuplicates: true },
      );
      await m.org.db.from("meetings").update({ status: "no_result", moved_to_date: later, resolved_at: new Date().toISOString(), result: "Перенесено" }).eq("id", m.id);
      const moved = await post(m.org, "/api/workspace/meeting-moved", { fromId: m.id, toId });
      check(`[${i}] перенос на ${later}`, !error && moved.status === 200, { error: error?.message, moved });
      allMeetings.add(toId);
      for (const p of [m.org, ...m.guests]) expect.meetings[u.indexOf(p)].add(toId);
      const { data: guestSeesNew } = await m.guests[0].db.from("meetings").select("id").eq("id", toId);
      check(`[${i}] приглашённый видит перенесённую встречу`, (guestSeesNew || []).length === 1, guestSeesNew);
    }
  }
  {
    const closed = meetings[0];
    const g = closed.guests[0];
    const { error } = await g.db.from("item_comments").insert({
      user_id: space, item_kind: "meeting", item_id: closed.id, author_user_id: g.id, author_assignee_id: g.row.id, body: "после итога", source: "app",
    });
    check("в закрытую встречу не пишут", !!error, error?.message);
    const again = await post(closed.org, "/api/workspace/recap", { meetingId: closed.id, result: "Второй итог", outcome: "success" });
    const { data: lines } = await admin.from("item_comments").select("body").eq("item_id", closed.id).eq("system", true);
    check("второй итог не пишется поверх первого", again.status >= 400 || (lines || []).filter((l) => /Второй итог/.test(l.body)).length === 0, { again, lines });
  }

  // ── Мысли ───────────────────────────────────────────────────────────────
  section("Мысли: каждый записывает свою");
  const ideas = [];
  for (let i = 0; i < 10; i++) {
    const id = randomUUID();
    const { error } = await u[i].db.from("ideas").insert({
      id, user_id: space, text: `Мысль ${i} от ${u[i].name}`, ...(u[i].id === space ? {} : { created_by: u[i].id }),
    });
    if (error) check(`${u[i].name} записывает мысль`, false, error.message);
    ideas.push({ id, by: u[i] });
    allIdeas.add(id);
    expect.ideas[i].add(id);
  }
  check("десять мыслей записаны", ideas.length === 10);
  {
    const { data } = await u[1].db.from("ideas").select("id").in("id", ideas.map((x) => x.id));
    check("чужие мысли не видны — у Анны видна только её", (data || []).length === 1 && data[0].id === ideas[1].id, data);
  }

  section("Мысли: отправить следующему");
  for (let i = 0; i < 10; i++) {
    const idea = ideas[i];
    const to = u[(i + 1) % 10];
    const r = await post(idea.by, "/api/telegram/send", { kind: "idea", id: idea.id, to: [to.name], mode: "send" });
    const { data: rec } = await admin.from("idea_recipients").select("id, kind, assignee_id, user_id").eq("idea_id", idea.id);
    const ok = r.status === 200 && (r.body?.sentTo || []).includes(to.name) && (rec || []).length === 1 && rec[0].kind === "send";
    check(`${idea.by.name} → ${to.name}: мысль отправлена`, ok, { r: r.body, rec });
    // Строка рассылки — строка ПРОСТРАНСТВА, как и всё остальное: иначе её
    // не вычистит ни уборка пространства, ни удаление человека.
    if (rec?.[0] && rec[0].user_id !== space) check(`строка рассылки мысли ${i} лежит в пространстве`, false, rec[0]);
    idea.to = to;
    idea.recId = rec?.[0]?.id;
    expect.ideas[u.indexOf(to)].add(idea.id);
  }
  // Повторная отправка тому же человеку дублей не заводит.
  {
    const again = await post(ideas[0].by, "/api/telegram/send", { kind: "idea", id: ideas[0].id, to: [ideas[0].to.name], mode: "send" });
    const { data: rec } = await admin.from("idea_recipients").select("id").eq("idea_id", ideas[0].id);
    check("повторная отправка тому же не плодит строк", again.status === 200 && (rec || []).length === 1, { again: again.body, rec });
  }
  for (const idea of ideas) {
    const { data: inc } = await idea.to.db.from("idea_recipients").select("id, ideas(text)").eq("idea_id", idea.id).maybeSingle();
    if (!inc?.ideas) check(`${idea.to.name} видит присланную мысль с текстом`, false, inc);
    const third = u[(u.indexOf(idea.to) + 1) % 10];
    const { data: leak } = await third.db.from("ideas").select("id").eq("id", idea.id);
    if (third !== idea.by && (leak || []).length) check(`${third.name} не видит чужую отправленную мысль`, false, leak);
    const { data: authorView } = await idea.by.db.from("idea_recipients").select("assignee_id").eq("idea_id", idea.id);
    if ((authorView || [])[0]?.assignee_id !== idea.to.row.id) check(`${idea.by.name} видит, кому отправил`, false, authorView);
  }
  check("получатели видят присланное, третьи — нет, авторы видят, кому ушло", true);

  section("Мысли: десять разных ответов");
  for (const [i, idea] of ideas.entries()) {
    const path = i % 5;
    const to = idea.to;
    const stranger = u[(u.indexOf(to) + 3) % 10];
    const foreign = await post(stranger, "/api/workspace/report", { action: "ack_idea", recipientId: idea.recId });
    if (foreign.status !== 403) check(`[${i}] на чужую мысль не отвечают`, false, foreign);

    if (path === 0) {
      const ack = await post(to, "/api/workspace/report", { action: "ack_idea", recipientId: idea.recId });
      const { data: row } = await admin.from("idea_recipients").select("seen_at, converted_task_id").eq("id", idea.recId).maybeSingle();
      check(`[${i}] «Прочитать»`, ack.status === 200 && !!row?.seen_at && !row?.converted_task_id, { ack, row });
    } else if (path === 1) {
      // «Сохранить» и переслать дальше: копия становится СВОЕЙ мыслью
      // получателя (её кладёт браузер), и ею он делится с третьим.
      const keep = await post(to, "/api/workspace/report", { action: "keep_idea", ideaId: idea.id });
      const copyId = randomUUID();
      const { error: copyErr } = await to.db.from("ideas").insert({ id: copyId, user_id: space, text: `Мысль ${i} от ${idea.by.name}`, ...(to.id === space ? {} : { created_by: to.id }) });
      expect.ideas[u.indexOf(to)].add(copyId);
      allIdeas.add(copyId);
      const third = u[(u.indexOf(to) + 2) % 10];
      const share = await post(to, "/api/telegram/send", { kind: "idea", id: copyId, to: [third.name], mode: "share" });
      const { data: shared } = await admin.from("idea_recipients").select("kind").eq("idea_id", copyId).eq("assignee_id", third.row.id).maybeSingle();
      check(`[${i}] «Сохранить» + переслать копию: ${to.name} → ${third.name}`, keep.status === 200 && !copyErr && share.status === 200 && shared?.kind === "share", { keep, copyErr, share: share.body, shared });
      expect.ideas[u.indexOf(third)].add(copyId);
      const { data: thirdSees } = await third.db.from("ideas").select("text").eq("id", copyId).maybeSingle();
      check(`[${i}] ${third.name} видит пересланную копию`, !!thirdSees?.text, thirdSees);
      const { data: originalHidden } = await third.db.from("ideas").select("id").eq("id", idea.id);
      check(`[${i}] но не видит исходную мысль автора`, third === idea.by || !(originalHidden || []).length, originalHidden);
      const { data: authorNoThird } = await idea.by.db.from("idea_recipients").select("assignee_id").eq("idea_id", copyId);
      check(`[${i}] автор исходной не видит, кому переслали копию`, idea.by === third || idea.by === to || !(authorNoThird || []).length, authorNoThird);
    } else if (path === 2) {
      const take = await post(to, "/api/workspace/report", { action: "take_idea", recipientId: idea.recId });
      const tid = take.body?.taskId;
      const row = tid ? (await admin.from("tasks").select("deadline, created_by, title").eq("id", tid).maybeSingle()).data : null;
      check(`[${i}] «Взять в работу» — задача на себя`, take.status === 200 && !!tid, take);
      check(`[${i}] у взятой задачи есть срок`, !!row?.deadline, row);
      check(`[${i}] постановщик взятой задачи — автор мысли`, (row?.created_by || space) === idea.by.id, row);
      if (tid) seeTask(tid, idea.by, to);
    } else if (path === 3) {
      // В трекере «Поручить» — обычная форма новой задачи, потом маршрут
      // связывает мысль с задачей.
      const colleague = u[(u.indexOf(to) + 4) % 10];
      const t = await makeTask(to, { title: `Из мысли ${i}`, executors: [colleague] });
      const link = await post(to, "/api/workspace/report", { action: "idea_task", recipientId: idea.recId, taskId: t.id });
      let conv = null;
      for (let k = 0; k < 12 && !conv; k++) {
        conv = (await admin.from("idea_recipients").select("converted_task_id").eq("id", idea.recId).maybeSingle()).data?.converted_task_id;
        if (!conv) await wait(500);
      }
      check(`[${i}] мысль → задача коллеге ${colleague.name}`, !t.error && link.status === 200 && conv === t.id, { err: t.error, link, conv });
      seeTask(t.id, to, colleague);
    } else {
      // «Назначить встречу» — с автором мысли в составе.
      const mid = randomUUID();
      const { error } = await to.db.from("meetings").insert({
        id: mid, user_id: space, title: `Обсудить мысль ${i}`, date: tomorrow, time: "17:00", duration_min: 30,
        participants: [idea.by.name], status: "planned", ...(to.id === space ? {} : { created_by: to.id }),
      });
      await to.db.from("meeting_participants").upsert(
        [
          { user_id: space, meeting_id: mid, assignee_id: to.row.id, role: "organizer", response: "yes", round: 1 },
          { user_id: space, meeting_id: mid, assignee_id: idea.by.row.id, role: "participant", response: "none", round: 1 },
        ],
        { onConflict: "meeting_id,assignee_id", ignoreDuplicates: true },
      );
      const link = await post(to, "/api/workspace/report", { action: "idea_meeting", recipientId: idea.recId, meetingId: mid });
      const { data: authorSees } = await idea.by.db.from("meetings").select("id").eq("id", mid);
      check(`[${i}] мысль → встреча с автором`, !error && link.status === 200 && (authorSees || []).length === 1, { error: error?.message, link, authorSees });
      allMeetings.add(mid);
      expect.meetings[u.indexOf(to)].add(mid);
      expect.meetings[u.indexOf(idea.by)].add(mid);
    }
  }

  section("Мысли: своя мысль становится задачей и встречей");
  {
    const me = u[2];
    const own = randomUUID();
    await me.db.from("ideas").insert({ id: own, user_id: space, text: "Своя мысль в задачу", created_by: me.id });
    allIdeas.add(own);
    const t = await makeTask(me, { title: "Своя мысль в задачу", executors: [u[6]] });
    // Мысль, ставшая задачей, вычёркивается (done) — так её убирает форма.
    const { error: doneErr } = await me.db.from("ideas").update({ done: true, done_at: new Date().toISOString() }).eq("id", own);
    check("мысль → задача и вычеркнута", !t.error && !doneErr, t.error || doneErr?.message);
    seeTask(t.id, me, u[6]);
    expect.ideas[2].add(own);
    const { data: other } = await u[6].db.from("ideas").select("id").eq("id", own);
    check("исполнитель задачи не видит мысль, из которой она выросла", !(other || []).length, other);
  }

  // ── Обсуждение кольца ───────────────────────────────────────────────────
  section("Обсуждение: постановщик и исполнитель переписываются");
  {
    const t = await makeTask(u[8], { title: "Открытая для переписки", executors: [u[9]] });
    seeTask(t.id, u[8], u[9]);
    const say = async (who, text) =>
      (await who.db.from("item_comments").insert({ user_id: space, item_kind: "task", item_id: t.id, author_user_id: who.id, author_assignee_id: who.row.id, body: text, source: "app" }).select("id").maybeSingle());
    const a = await say(u[8], "Как дела?");
    const b = await say(u[9], "Делаю");
    check("оба пишут", !a.error && !b.error, a.error?.message || b.error?.message);
    const c = await post(u[9], "/api/workspace/comment", { commentId: b.data?.id });
    check("маршрут рассылки принимает реплику автора", c.status === 200, c);
    const forged = await post(u[8], "/api/workspace/comment", { commentId: b.data?.id });
    check("чужую реплику разослать от себя нельзя", forged.status >= 400, forged);
    const { data: list } = await u[8].db.from("item_comments").select("body").eq("item_id", t.id).eq("system", false);
    check("постановщик видит обе реплики", (list || []).length === 2, list);
    const { data: none } = await u[1].db.from("item_comments").select("id").eq("item_id", t.id);
    check("посторонний — ни одной", !(none || []).length, none);
  }

  // ── Итог: каждый видит ровно своё ───────────────────────────────────────
  section("Каждый из десяти видит ровно своё");
  for (let i = 0; i < 10; i++) {
    const who = u[i];
    const { data: t } = await who.db.from("tasks").select("id").in("id", [...allTasks]).is("deleted_at", null);
    const gotT = new Set((t || []).map((r) => r.id));
    const extraT = [...gotT].filter((id) => !expect.tasks[i].has(id));
    const missT = [...expect.tasks[i]].filter((id) => !gotT.has(id));
    check(`${who.name}: задачи — ${expect.tasks[i].size}`, !extraT.length && !missT.length, { extra: extraT.length, missing: missT.length });

    const { data: m } = await who.db.from("meetings").select("id").in("id", [...allMeetings]).is("deleted_at", null);
    const gotM = new Set((m || []).map((r) => r.id));
    const extraM = [...gotM].filter((id) => !expect.meetings[i].has(id));
    const missM = [...expect.meetings[i]].filter((id) => !gotM.has(id));
    check(`${who.name}: встречи — ${expect.meetings[i].size}`, !extraM.length && !missM.length, { extra: extraM.length, missing: missM.length });

    const { data: d } = await who.db.from("ideas").select("id").in("id", [...allIdeas]);
    const gotI = new Set((d || []).map((r) => r.id));
    const extraI = [...gotI].filter((id) => !expect.ideas[i].has(id));
    const missI = [...expect.ideas[i]].filter((id) => !gotI.has(id));
    check(`${who.name}: мысли — ${expect.ideas[i].size}`, !extraI.length && !missI.length, { extra: extraI.length, missing: missI.length });
  }
} catch (err) {
  check("прогон дошёл до конца", false, String(err?.stack || err));
} finally {
  for (const id of created.reverse()) await admin.auth.admin.deleteUser(id).catch(() => {});
  console.log(`\n${checks - failures} из ${checks} проверок прошли.`);
  if (failures) console.log("Упали:\n  " + failed.join("\n  "));
}
process.exit(failures ? 1 : 0);
