import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const cleanupId = process.argv[2];
if (cleanupId) { const { error } = await admin.auth.admin.deleteUser(cleanupId); console.log(error ? error.message : "deleted"); process.exit(0); }
const email = `tmp-${Date.now()}@example.invalid`;
const password = "Tmp-" + Math.random().toString(36).slice(2) + "!Aa1";
const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) { console.error(error.message); process.exit(1); }
const uid = data.user.id;
let n = 0;
const id = () => "t" + Date.now().toString(36) + n++ + Math.random().toString(36).slice(2, 7);
const today = new Date(); const iso = (d) => d.toISOString().slice(0,10);
const plus = (k) => { const d = new Date(today); d.setDate(d.getDate()+k); return iso(d); };
const task = (o) => ({ id: id(), user_id: uid, description: "", assignee: "", priority: "med", term: "short", status: "in_progress", recur: "none", ...o });
await admin.from("assignees").insert(["Кирилл (я)","Никита Козлов","Наталья Мамакова"].map(name => ({ user_id: uid, name })));
await admin.from("tasks").insert([
  task({ title: "Просроченная задача", assignee: "Никита Козлов", priority: "high", deadline: plus(-4) }),
  task({ title: "Задача на сегодня", assignee: "Наталья Мамакова", deadline: iso(today) }),
  task({ title: "Задача без срока", assignee: "Никита Козлов" }),
]);
await admin.from("meetings").insert([{ id: id(), user_id: uid, title: "Совещание по опту", date: plus(1), time: "11:00", participants: ["Никита Козлов"], status: "planned", result: "" }]);
await admin.from("ideas").insert([{ id: id(), user_id: uid, text: "Идея про склад в Севастополе", important: true, done: false }]);
console.log(JSON.stringify({ id: uid, email, password }));
