// Переименовать человека — во всех местах разом.
//
// Имя человека в трекере живёт не в одном месте, и это не небрежность, а
// осознанная пара: строка в `assignees` — это ЧЕЛОВЕК (по её id держатся
// участие, голоса, привязки к разделам, чат мессенджера), а `tasks.assignee`
// и `meetings.participants` — это ИМЯ, написанное на карточке и в сообщении
// бота. Пока они совпадают буква в букву, всё честно: по имени находят
// строку (триггер миграции 0024, assignExecutors, сводки).
//
// Переименовать человека в одной только `assignees` значит развести их:
// девять задач останутся подписаны прежним именем, и трекер перестанет
// узнавать в нём настоящего человека — ровно та «вторая правда об одном
// факте», которой в этом проекте уже стоила аудита 15.09.2026.
//
// Поэтому переименование делает этот скрипт, и делает его целиком:
//
//   node --env-file=.env.local scripts/rename-person.mjs "Старое имя" "Новое имя"
//   node --env-file=.env.local scripts/rename-person.mjs "Старое имя" "Новое имя" --apply
//
// Без --apply только показывает, что изменится. Пометка «(я)» — часть
// имени строки владельца, и её надо сохранять: по ней трекер понимает,
// какая строка его собственная (isSelfAssignee).
import pg from "pg";

const [, , fromArg, toArg, ...rest] = process.argv;
const apply = rest.includes("--apply");
// Пространство, если одно и то же имя есть у нескольких владельцев.
// Так бывает чаще, чем кажется: «Кирилл (я)» — имя строки владельца по
// умолчанию, и его носит каждое одноразовое пространство, созданное e2e.
const spaceAt = rest.indexOf("--space");
const space = spaceAt >= 0 ? rest[spaceAt + 1] : "";

if (!fromArg || !toArg) {
  console.error('Как звать: node --env-file=.env.local scripts/rename-person.mjs "Старое имя" "Новое имя" [--apply]');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Нужен DATABASE_URL — запускайте с --env-file=.env.local");

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

const { rows: people } = space
  ? await db.query("select id, user_id, name from assignees where name = $1 and user_id = $2", [fromArg, space])
  : await db.query("select id, user_id, name from assignees where name = $1", [fromArg]);
if (!people.length) {
  console.error(`Человека с именем «${fromArg}» нет. Проверьте написание — оно должно совпадать буква в букву.`);
  await db.end();
  process.exit(1);
}
if (people.length > 1) {
  console.error(
    `Людей с именем «${fromArg}» несколько (${people.length}) — в разных пространствах.\n` +
      "Укажите, чьё: --space <user_id владельца>.",
  );
  await db.end();
  process.exit(1);
}

const person = people[0];
const { rows: taken } = await db.query("select id from assignees where user_id = $1 and name = $2", [person.user_id, toArg]);
if (taken.length) {
  console.error(`В этом пространстве уже есть «${toArg}». Два человека с одним именем трекер различать не умеет.`);
  await db.end();
  process.exit(1);
}

const { rows: tasks } = await db.query("select count(*)::int c from tasks where user_id = $1 and assignee = $2", [
  person.user_id,
  fromArg,
]);
const { rows: meetings } = await db.query("select count(*)::int c from meetings where user_id = $1 and $2 = any(participants)", [
  person.user_id,
  fromArg,
]);

console.log(`«${fromArg}» → «${toArg}»`);
console.log(`  строка в списке людей: 1`);
console.log(`  задач с этим именем: ${tasks[0].c}`);
console.log(`  встреч с этим именем в составе: ${meetings[0].c}`);

if (!apply) {
  console.log("\nНичего не изменено. Повторите с --apply.");
  await db.end();
  process.exit(0);
}

// Одной транзакцией: половина переименования хуже, чем ни одной, — имя на
// карточке перестанет находить человека, и задача станет «назначенной
// только на словах».
await db.query("begin");
try {
  await db.query("update assignees set name = $1 where id = $2", [toArg, person.id]);
  await db.query("update tasks set assignee = $1 where user_id = $2 and assignee = $3", [toArg, person.user_id, fromArg]);
  await db.query(
    "update meetings set participants = array_replace(participants, $1, $2) where user_id = $3 and $1 = any(participants)",
    [fromArg, toArg, person.user_id],
  );
  await db.query("commit");
  console.log("\nГотово.");
} catch (error) {
  await db.query("rollback");
  console.error("\nНе получилось, ничего не изменено:", error.message);
  process.exitCode = 1;
}

await db.end();
