// Вернули на доработку, а человек всё ещё «Ещё не приступал».
//
// До 30.10.2026 возврат снимал отчёт и не ставил accepted_at: кто сдавал
// прямо из «Новых», не нажав «Принял», после возврата выглядел так, будто
// задачу не видел (№154). Код это больше не делает (markReturnedAsWorking в
// lib/reviewWork), а уже возвращённые строки сами не исправятся.
//
//   node --env-file=.env.local scripts/fix-returned-working.mjs         # показать
//   node --env-file=.env.local scripts/fix-returned-working.mjs --fix   # исправить
//
// Кого вернули, видно по хронике задачи: общий возврат пишет
// «вернул на доработку: …» (вернули всем ответившим, то есть всем
// исполнителям), частичный и «одному» — «вернул на доработку Имя, Имя: …».
// Берём последнюю такую строку; человек, ответивший уже после неё, не
// трогается — он снова сдал или отказался, это его новый ответ.
import pg from "pg";

const fix = process.argv.includes("--fix");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const ROWS = `
  select p.id, p.task_id, t.number, t.title, a.name, r.body as return_line, r.created_at as returned_at
    from task_participants p
    join tasks t on t.id = p.task_id
    join assignees a on a.id = p.assignee_id
    join lateral (
      select c.body, c.created_at
        from item_comments c
       where c.item_id = t.id and c.system and c.body like '%вернул на доработку%'
       order by c.created_at desc
       limit 1
    ) r on true
   where p.role = 'executor'
     and p.accepted_at is null
     and p.done_at is null
     and p.declined_at is null
     and t.deleted_at is null
     and t.status <> 'done'
     and coalesce(t.approval_state, 'open') <> 'accepted'
   order by t.number`;

const clean = (name) => name.replace(/\s*\(я\)\s*/g, "").trim();

function wasReturned(row) {
  const after = row.return_line.split("вернул на доработку")[1] || "";
  if (after.startsWith(":")) return true; // общий возврат — всем исполнителям
  const names = after.slice(0, after.indexOf(":") >= 0 ? after.indexOf(":") : undefined);
  return names.includes(clean(row.name));
}

const { rows } = await client.query(ROWS);
const hit = rows.filter(wasReturned);
for (const r of hit) console.log(`#${r.number ?? "?"} «${r.title.slice(0, 60)}» — ${clean(r.name)} (возврат ${r.returned_at.toISOString().slice(0, 16)})`);
console.log(`\nВернули, а «Ещё не приступал»: ${hit.length}`);

if (fix && hit.length) {
  // Время принятия — момент возврата: с него человек и снова в работе.
  for (const r of hit) {
    await client.query("update task_participants set accepted_at = $2 where id = $1 and accepted_at is null", [r.id, r.returned_at]);
  }
  console.log(`Исправлено: ${hit.length}`);
} else if (hit.length) {
  console.log("Исправить: добавьте --fix");
}
await client.end();
