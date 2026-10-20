import https from "node:https";
import crypto from "node:crypto";
import { russianCaAgent as agent } from "@/lib/russianCa";

// GigaChat's servers use a certificate chain issued by the Russian Ministry
// of Digital Development's own root CA, which isn't in Node's default trust
// store. That agent carries the root; it moved to russianCa.ts when MAX
// turned out to need exactly the same thing.

function httpsRequest(
  url: string,
  options: https.RequestOptions,
  body?: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { ...options, agent }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, text: data }));
    });
    req.on("error", reject);
    // Молчащий сервер не должен держать бота до конца жизни функции: через
    // 25 секунд запрос рвётся, и цепочка моделей берёт следующую.
    req.setTimeout(25_000, () => req.destroy(new Error("GigaChat не ответил за 25 секунд")));
    if (body) req.write(body);
    req.end();
  });
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 30_000 > Date.now()) {
    return cachedToken.value;
  }

  const authKey = process.env.GIGACHAT_AUTH_KEY;
  if (!authKey) throw new Error("GIGACHAT_AUTH_KEY не задан");

  const body = new URLSearchParams({ scope: "GIGACHAT_API_PERS" }).toString();
  const res = await httpsRequest(
    "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        RqUID: crypto.randomUUID(),
        Authorization: "Basic " + authKey,
      },
    },
    body,
  );

  if (res.status !== 200) {
    throw new Error(`GigaChat OAuth ${res.status}: ${res.text.slice(0, 300)}`);
  }
  const json = JSON.parse(res.text) as { access_token: string; expires_at: number };
  cachedToken = { value: json.access_token, expiresAt: json.expires_at };
  return json.access_token;
}

// Какой моделью отвечать.
//
// До 20.10.2026 весь бот работал на «GigaChat» — младшей модели (Lite), хотя
// ключ проекта открывает и старшие: проверка /api/v1/balance показала
// пакеты GigaChat-Max (25 млн токенов) и GigaChat-Pro (40 млн) нетронутыми.
// Слова Кирилла в тот день: «Гига чат не достаточно умно отвечает…
// простая просьба о переносе конкретной встречи так и не решилась».
// Половина той беды была в устройстве бота (он не видел разговора), но
// Lite и правда путает намерения там, где Max их различает.
//
// Модели идут цепочкой: кончился пакет (402), упёрлись в предел частоты
// (429), модель сняли с API (404) или она легла (5xx) — берётся следующая,
// а не ответ «не получилось». Бот, который вдруг поглупел, лучше бота,
// который замолчал. `smart` — разбор того, что пишет человек, и ответы на
// его вопросы: там ошибка стоит действия не над тем делом. `light` —
// утренняя и недельная сводки: модель там только переписывает готовые
// факты своими словами (factGuard проверяет их всё равно), и тратить на
// это пакет Max незачем.
const CHAINS: Record<"smart" | "light", string[]> = {
  smart: ["GigaChat-2-Max", "GigaChat-2-Pro", "GigaChat"],
  light: ["GigaChat-2-Pro", "GigaChat"],
};

// Модель, переставшая отвечать, пропускается на десять минут: иначе каждое
// сообщение сначала тратит запрос на заведомый отказ.
const skipUntil = new Map<string, number>();
const SKIP_MS = 10 * 60 * 1000;

function chainFor(tier: "smart" | "light"): string[] {
  // Переопределение через окружение — чтобы сменить модель без выкладки
  // кода, если Сбер переименует их снова.
  const forced = (process.env.GIGACHAT_MODEL || "").trim();
  const chain = forced ? [forced, ...CHAINS[tier].filter((m) => m !== forced)] : CHAINS[tier];
  const now = Date.now();
  const alive = chain.filter((m) => (skipUntil.get(m) || 0) < now);
  return alive.length ? alive : chain.slice(-1);
}

export async function gigaChatComplete(params: {
  system: string;
  user: string;
  temperature?: number;
  tier?: "smart" | "light";
}): Promise<string> {
  const token = await getAccessToken();
  let lastError = "";
  for (const model of chainFor(params.tier || "smart")) {
    const body = JSON.stringify({
      model,
      temperature: params.temperature ?? 0.2,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    });

    const res = await httpsRequest(
      "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Bearer " + token,
        },
      },
      body,
    ).catch((e: unknown) => ({ status: 0, text: e instanceof Error ? e.message : String(e) }));

    if (res.status === 200) {
      const json = JSON.parse(res.text) as { choices: { message: { content: string } }[] };
      return json.choices[0]?.message?.content ?? "";
    }
    lastError = `GigaChat completion ${model} ${res.status}: ${res.text.slice(0, 300)}`;
    // 400 — ошибка в самом запросе, следующая модель ответит тем же.
    if (res.status === 400 || res.status === 401) break;
    skipUntil.set(model, Date.now() + SKIP_MS);
    console.error(lastError);
  }
  throw new Error(lastError || "GigaChat не ответил");
}
