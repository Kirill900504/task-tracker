// Назначено ли то, что выглядит назначенным.
//
// У задачи два способа сказать, кто её делает: текстовое поле `assignee` на
// карточке и строки task_participants, в которых живут «Принял / Сделал / Не
// могу», «2 из 4» и статистика по людям. У встречи — то же самое:
// meetings.participants рисуется на карточке, meeting_participants держит
// голосование и напоминания.
//
// Пока эти двое расходятся, трекер врёт молча и в самую дорогую сторону:
// постановщик видит имя и считает, что поручил, а человеку не пришло ничего.
// Ровно это и нашлось на боевой базе 15.09.2026 — две задачи и 26 встреч из
// 28. Причины были в коде и починены (assignExecutors.ts), но уже созданные
// строки от этого не исправятся.
//
//   node --env-file=.env.local scripts/check-assignments.mjs         # показать
//   node --env-file=.env.local scripts/check-assignments.mjs --fix   # дозавести
//
// Без --fix не меняет ничего. Стоит запускать и просто так: это самый
// дешёвый способ заметить, что появился третий путь создания задач, который
// снова забыл про людей.
import pg from "pg";

const fix = process.argv.includes("--fix");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

// Задачи: открытые, с именем на карточке и без единой строки участия.
// Закрытые не трогаем — дозаводить исполнителя задаче, которая уже сделана,
// значит поднять её из мёртвых в чужом списке.
const TASKS = `
  select t.id, t.title, t.assignee, t.user_id, a.id as assignee_id
    from tasks t
    join assignees a on a.user_id = t.user_id and a.name = t.assignee
   where t.deleted_at is null
     and t.status <> 'done'
     and coalesce(t.assignee, '') <> ''
     and not exists (select 1 from task_participants p where p.task_id = t.id)
   order by t.created_at`;

// Встречи: только будущие и ещё не состоявшиеся. Голосовать за прошедшую
// встречу некому и незачем.
const MEETINGS = `
  select m.id, m.title, m.date, m.user_id, a.id as assignee_id, a.name
    from meetings m
    cross join lateral unnest(m.participants) as person(name)
    join assignees a on a.user_id = m.user_id and a.name = person.name
   where m.deleted_at is null
     and m.status = 'planned'
     and m.date >= current_date
     and a.name not ilike '%(я)%'
     and not exists (select 1 from meeting_participants p where p.meeting_id = m.id and p.assignee_id = a.id)
   order by m.date`;

const tasks = (await client.query(TASKS)).rows;
const meetings = (await client.query(MEETINGS)).rows;

console.log(`Задачи, назначенные только на словах: ${tasks.length}`);
for (const t of tasks) console.log(`  «${t.title.slice(0, 60)}» → ${t.assignee}`);

console.log(`\nПриглашения на встречи без строки голосования: ${meetings.length}`);
const byMeeting = new Map();
for (const m of meetings) {
  const list = byMeeting.get(m.id) || { title: m.title, date: m.date, names: [] };
  list.names.push(m.name);
  byMeeting.set(m.id, list);
}
for (const [, m] of byMeeting) {
  console.log(`  ${m.date.toISOString().slice(0, 10)} «${m.title.slice(0, 50)}» → ${m.names.join(", ")}`);
}

if (!fix) {
  const total = tasks.length + meetings.length;
  console.log(total ? `\nВсего расхождений: ${total}. Чтобы дозавести — повторите с --fix.` : "\nРасхождений нет.");
  await client.end();
  process.exit(0);
}

// Строки заводятся ровно те, которых не хватает. user_id проставляет
// триггер от родителя — писать его здесь нельзя (миграция 0019).
//
// Никаких сообщений в мессенджер: человеку, которому задачу поставили
// неделю назад, «вам назначена задача» сегодня ночью — это не почин, а
// испуг. Он увидит её в трекере и в ближайшей утренней сводке.
let taskRows = 0;
for (const t of tasks) {
  await client.query(
    "insert into task_participants (task_id, assignee_id, role) values ($1, $2, 'executor') on conflict do nothing",
    [t.id, t.assignee_id],
  );
  taskRows++;
}
let meetingRows = 0;
for (const m of meetings) {
  await client.query(
    "insert into meeting_participants (meeting_id, assignee_id, role, response, round) values ($1, $2, 'participant', 'none', 1) on conflict do nothing",
    [m.id, m.assignee_id],
  );
  meetingRows++;
}
console.log(`\nДозаведено: исполнителей ${taskRows}, приглашений ${meetingRows}.`);
await client.end();
