import { sharesPrefix, stem } from "@/lib/stem";

// Какую задачу или встречу человек назвал словами.
//
// 19.10.2026: встреча в трекере называлась «телемост с Вадимом Яцнко
// (директолог)» — с опечаткой, — а Кирилл писал боту «Встреча Телемост с
// Вадимом Яценко». Прежний подбор (`fuzzyMatch` в telegramManage) искал
// ПОДСТРОКУ: одна буква, и совпадения нет. А в живой речи название не
// цитируют, его пересказывают — «телемост», «встречу с Вадимом», «смету
// Игорю», — поэтому сравнение идёт по словам, и слово совпадает с
// опечаткой, с другим падежом и с сокращением.
//
// Чистые функции без базы: варианты приходят списком, ответ — те, что
// подходят. Решает, что делать с несколькими, вызывающий: он показывает
// их кнопками, а не угадывает.

// Слова, которые есть в каждой просьбе и ничего не говорят о том, КАКУЮ
// встречу имеют в виду. Без них «перенеси встречу с Вадимом» совпадала бы
// с любой встречей, в названии которой есть «встреча».
const NOISE = new Set([
  "встреча",
  "встречу",
  "встречи",
  "задача",
  "задачу",
  "задачи",
  "перенеси",
  "перенести",
  "перенос",
  "сдвинь",
  "сдвинуть",
  "передвинь",
  "эту",
  "этот",
  "это",
  "эта",
  "тот",
  "ту",
  "срок",
  "только",
  "день",
  "дату",
  "время",
  "следующий",
  "следующую",
  "неделю",
  "понедельник",
  "вторник",
  "среду",
  "четверг",
  "пятницу",
  "субботу",
  "воскресенье",
  "завтра",
  "сегодня",
  "послезавтра",
]);

export function words(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w));
}

// Расстояние правки: сколько букв поменять, вставить или убрать.
function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = keep;
    }
  }
  return prev[b.length];
}

// Одно ли это слово: тот же корень, общее начало или опечатка. Опечатка
// прощается в длинных словах — у коротких одна буква меняет смысл («сбор»
// и «спор»), у длинных почти никогда.
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (stem(a) === stem(b)) return true;
  const shortest = Math.min(a.length, b.length);
  if (shortest >= 5 && sharesPrefix(a, b, Math.min(5, shortest - 1))) return true;
  if (shortest >= 5 && distance(a, b) <= (shortest >= 8 ? 2 : 1)) return true;
  // «Яценко» ↔ «Яцнко» — пропущенная буква при общем начале.
  if (shortest >= 4 && sharesPrefix(a, b, 2) && distance(a, b) <= 1) return true;
  return false;
}

// Доля слов запроса, нашедших себе пару в названии. 0 — ничего общего.
export function matchScore(title: string, query: string): number {
  const q = words(query);
  const t = words(title);
  if (!q.length || !t.length) return 0;
  let hit = 0;
  for (const w of q) if (t.some((x) => sameWord(w, x))) hit++;
  return hit / q.length;
}

// Обратный вопрос — насколько НАЗВАНИЕ встречается в тексте. Им ищется
// встреча в сообщении бота, на которое ответили («Через 15 минут:
// «телемост с Вадимом…»»): там название целиком, а вокруг — чужие слова.
export function coverage(title: string, text: string): number {
  const t = words(title);
  const x = words(text);
  if (!t.length || !x.length) return 0;
  let hit = 0;
  for (const w of t) if (x.some((y) => sameWord(w, y))) hit++;
  return hit / t.length;
}

// Лучшие совпадения. Один явный лидер — он один; несколько равных — все
// они (вызывающий спросит кнопками). Порог — половина слов: «телемост» из
// «перенеси телемост» — уже достаточно, если такой встречи больше нет.
export function bestMatches<T extends { title: string }>(items: T[], query: string, threshold = 0.5): T[] {
  const scored = items
    .map((item) => ({ item, score: matchScore(item.title, query) }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((s) => s.score >= top - 0.001).map((s) => s.item);
}
