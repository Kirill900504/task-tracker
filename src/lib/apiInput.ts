import { z } from "zod";
import { NextResponse } from "next/server";

// Что маршрут соглашается принять.
//
// До сих пор каждый маршрут проверял тело сам, строкой вида
// `typeof body?.x === "string" ? ... : ""`. Проверки эти неплохи, но у них
// три беды: они проверяют наличие и не проверяют СМЫСЛ (пустая строка,
// «да» вместо даты, чужой id формата «‑‑»), они повторяются в каждом
// маршруте по-своему, и они молчат о том, что именно не так — маршрут
// отвечает «Неполный запрос», не называя поля.
//
// Схема заменяет всё это одним объявлением: она же описывает тип, она же
// проверяет, она же называет виноватое поле. Трекер принимает данные не
// только из своего браузера — из двух мессенджеров, из крона, из бота, — и
// формат этих сообщений меняем не мы.

export const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "дата должна быть в формате ГГГГ-ММ-ДД");

// Идентификаторы задач и мыслей НЕ uuid: они собираются в браузере
// (lib/uid.ts) и живут в тех же колонках. Проверяется поэтому длина и
// отсутствие пробелов, а не формат.
export const ID = z.string().trim().min(1, "пустой идентификатор").max(64);
export const UUID = z.string().uuid("ожидался идентификатор");
// Почта проверяется своим правилом, а не встроенным `.email()`. Встроенное
// требует ASCII в имени ящика и отвергает `нет-такой@example.invalid` —
// адреса с кириллицей существуют, а в наших же тестах такой стоит прямо в
// проверке. Здесь достаточно того, ради чего проверка и нужна: это одна
// строка с собакой и точкой после неё, а не имя человека, вписанное в поле
// почты по ошибке.
export const EMAIL = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u, "похоже, это не почта");

export const reportInput = z.object({
  action: z.enum(["accept", "done", "decline", "reschedule", "vote", "take_idea", "ack_idea", "keep_idea", "idea_task", "idea_meeting", "seen"]),
  // Для «seen»: чья это строка участия — задачи или встречи.
  kind: z.enum(["task", "meeting"]).optional(),
  participantId: UUID.optional(),
  recipientId: UUID.optional(),
  // «Взять в работу» из самого трекера знает мысль, а не строку рассылки:
  // строк рассылки в трекере нет вовсе, их видит только бот. Сервер сам
  // найдёт мою строку у этой мысли — и тем самым проверит, что её мне
  // действительно присылали.
  ideaId: ID.optional(),
  // «idea_task» / «idea_meeting»: присланная мысль стала задачей или
  // встречей, заведённой в обычной форме трекера (IncomingIdeas).
  taskId: ID.optional(),
  meetingId: ID.optional(),
  comment: z.string().max(4000).optional(),
  // «Сделал» за всю задачу, а не за свою часть: она уходит на приёмку, не
  // дожидаясь остальных исполнителей (closeIfEveryoneReported).
  whole: z.boolean().optional(),
  date: ISO_DATE.optional(),
  response: z.enum(["yes", "no", "late"]).optional(),
  round: z.number().int().nonnegative().optional(),
  // Документы к отчёту. Файлы к этому моменту УЖЕ в корзине: их кладёт
  // браузер (у него для этого есть права по первому сегменту пути, см.
  // миграцию 0020), а сюда приезжают только описания. Иначе пришлось бы
  // гнать содержимое файла через функцию, у которой на тело запроса свой
  // предел, а на время — четыре с половиной секунды.
  //
  // Путь проверяется по форме, а не по красоте: он собран из id
  // пространства, вида и id задачи, и всё, что нужно от этой проверки, —
  // не дать записать в колонку строку произвольной длины.
  attachments: z
    .array(
      z.object({
        path: z.string().min(1).max(400),
        name: z.string().min(1).max(200),
        size: z.number().int().nonnegative().max(20 * 1024 * 1024),
        type: z.string().max(120),
      }),
    )
    .max(10)
    .optional(),
});

export const reviewInput = z.object({
  action: z.enum(["approve", "return", "return_one", "wait", "force", "reopen", "moved", "kept", "deadline"]),
  taskId: ID,
  comment: z.string().max(4000).optional(),
  participantId: UUID.optional(),
  // «return» по выбранным исполнителям (строки участия). Нет — всем, кто
  // ответил, как раньше.
  participantIds: z.array(UUID).max(50).optional(),
  // null здесь значимо: «снять срок» — это не то же самое, что «не трогать».
  date: ISO_DATE.nullable().optional(),
});

export const commentInput = z.object({ commentId: UUID });

// Строка в хронику про состав задачи — кого добавили, убрали или
// переназначили. Текст собирает сам маршрут, а не браузер: присланный
// готовый текст было бы легко подделать («системная» строка, которую
// никто не писал), а так сервер сам находит имена по id и сам решает,
// имеет ли этот человек право менять состав именно этой задачи.
export const participantNoteInput = z.object({
  taskId: ID,
  assigneeId: UUID,
  action: z.enum(["add", "remove", "role"]),
  role: z.enum(["executor", "coexecutor", "watcher"]).optional(),
});

// Переименование человека. Имя — это то, по чему его находят все: карточка,
// бот, сводки, — поэтому пустое сюда не проходит, а длина ограничена так
// же, как у остальных имён в трекере.
export const renamePersonInput = z.object({
  assigneeId: UUID,
  name: z.string().trim().min(1, "имя не может быть пустым").max(120),
});

// Отсутствие (миграция 0047). Пустой `until` — «я на месте».
export const awayInput = z.object({
  assigneeId: UUID,
  until: z.union([ISO_DATE, z.literal("")]),
  kind: z.enum(["vacation", "sick", "trip", "other"]).optional(),
});

// Куда писать мне (миграция 0070).
export const messengerInput = z.object({ messenger: z.enum(["max", "telegram"]) });

export const inviteInput = z.object({
  assigneeId: UUID,
  email: EMAIL.optional(),
  direction: z.string().trim().max(200).optional(),
});

export const joinInput = z.object({
  code: z.string().trim().min(1, "в ссылке нет кода приглашения"),
  email: EMAIL.optional(),
  // Длину пароля проверяет Supabase — здесь только то, что он вообще есть.
  password: z.string().optional(),
});

export const accessLinkInput = z.object({ assigneeId: UUID });

// Люди в «Команде» (миграция 0055): завести, убрать с передачей дел,
// вернуть убранного.
export const personInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), name: z.string().trim().min(1, "имя не может быть пустым").max(120) }),
  z.object({
    action: z.literal("remove"),
    assigneeId: UUID,
    // Кому уходят открытые задачи и встречи. Без него маршрут только
    // считает, что есть, — и это первый шаг диалога, а не отказ.
    transferTo: UUID.nullable().optional(),
    dryRun: z.boolean().optional(),
  }),
  z.object({ action: z.literal("restore"), assigneeId: UUID }),
]);
// «Забыли пароль?» — почта ИЛИ фамилия (аудит 30.10.2026): у большинства
// вход заведён ботом на служебной почте, которую человек не видел ни разу,
// и поле «Почта» было для них тупиком. Ключ `email` остался ради прежних
// вызовов; что именно пришло, разбирает маршрут.
export const forgotPasswordInput = z
  .object({ email: z.string().trim().max(200).optional(), who: z.string().trim().max(200).optional() })
  .transform((v) => {
    const who = (v.who || v.email || "").trim();
    return { who: who.includes("@") ? who.toLowerCase() : who };
  })
  .refine((v) => v.who.length >= 2, { message: "укажите почту или фамилию", path: ["who"] })
  .refine((v) => !v.who.includes("@") || EMAIL.safeParse(v.who).success, { message: "не похоже на почту", path: ["who"] });

// Вход запросом в мессенджер (lib/loginPush): телефон или почта — одной
// строкой, разбирает маршрут.
export const loginPushInput = z.object({
  token: z.string().regex(/^LOGIN[A-Z0-9]{20}$/, "неверный запрос входа"),
  channel: z.enum(["telegram", "max"]),
  who: z.string().trim().min(5, "телефон или почта").max(200),
});

// Разобрать тело запроса. Ошибка возвращается готовым ответом — с именем
// поля, а не общим «Неполный запрос»: половина обращений «кнопка не
// работает» кончалась чтением логов ровно потому, что ответ не говорил
// ничего.
export async function readInput<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ data: z.infer<T>; error: null } | { data: null; error: NextResponse }> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { data: parsed.data, error: null };

  const first = parsed.error.issues[0];
  const field = first?.path.join(".") || "тело запроса";
  const message = first?.message || "не разобрать";
  return { data: null, error: NextResponse.json({ error: `Не принял запрос: ${field} — ${message}` }, { status: 400 }) };
}
