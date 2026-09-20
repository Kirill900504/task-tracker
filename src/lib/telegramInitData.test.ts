import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { checkInitData } from "./telegramInitData";

// Проверяется не «работает ли на честных данных» — это самая лёгкая
// половина. По итогу этой функции человек получает сессию в трекере, то
// есть она стоит ровно столько же, сколько пароль. Поэтому здесь в
// основном подложные данные.

const TOKEN = "123456:TEST-TOKEN-NOT-REAL";

// Подписать так, как это делает Telegram.
function sign(fields: Record<string, string>, token = TOKEN): string {
  const pairs = Object.entries(fields)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`);
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

const NOW = 1_758_000_000_000; // фиксированный «сейчас», чтобы тест не зависел от часов
const FRESH = String(Math.floor(NOW / 1000) - 10);
const USER = JSON.stringify({ id: 4242, first_name: "Игорь" });

describe("подпись мини-приложения", () => {
  it("пропускает честно подписанные данные", () => {
    const result = checkInitData(sign({ auth_date: FRESH, user: USER }), TOKEN, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe(4242);
  });

  it("не пропускает подделанного человека", () => {
    // Самая дорогая подмена: подписались своим аккаунтом, подставили чужой
    // id — и открыли чужой трекер.
    const honest = sign({ auth_date: FRESH, user: USER });
    const forged = honest.replace("4242", "9999");
    expect(checkInitData(forged, TOKEN, NOW).ok).toBe(false);
  });

  it("не пропускает данные, подписанные чужим токеном", () => {
    const other = sign({ auth_date: FRESH, user: USER }, "999:SOMEONE-ELSES-BOT");
    expect(checkInitData(other, TOKEN, NOW).ok).toBe(false);
  });

  it("не пропускает данные вовсе без подписи", () => {
    const params = new URLSearchParams({ auth_date: FRESH, user: USER });
    expect(checkInitData(params.toString(), TOKEN, NOW).ok).toBe(false);
  });

  it("не пропускает вчерашние данные", () => {
    // Подписаны честно — и тем опаснее: однажды перехваченная строка
    // открывала бы трекер бесконечно.
    const old = String(Math.floor(NOW / 1000) - 60 * 60 * 25);
    const result = checkInitData(sign({ auth_date: old, user: USER }), TOKEN, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("устарели");
  });

  it("не пропускает дату из будущего", () => {
    const ahead = String(Math.floor(NOW / 1000) + 600);
    expect(checkInitData(sign({ auth_date: ahead, user: USER }), TOKEN, NOW).ok).toBe(false);
  });

  it("терпит расхождение часов в несколько секунд", () => {
    // Часы сервера и Telegram расходятся на секунды постоянно; отказ из-за
    // этого выглядел бы как «мини-приложение не работает через раз».
    const ahead = String(Math.floor(NOW / 1000) + 30);
    expect(checkInitData(sign({ auth_date: ahead, user: USER }), TOKEN, NOW).ok).toBe(true);
  });

  it("не спотыкается о новые поля, которых мы не знаем", () => {
    // Telegram добавляет поля со временем (так появилась `signature`).
    // Проверка обязана считать подпись по тому, что пришло, а не по
    // списку, записанному сегодня.
    const withExtra = sign({ auth_date: FRESH, user: USER, chat_type: "private", query_id: "AAE", start_param: "x" });
    expect(checkInitData(withExtra, TOKEN, NOW).ok).toBe(true);
  });

  it("СЧИТАЕТ signature частью подписи — как настоящий Telegram", () => {
    // Этот тест раньше утверждал обратное, и из-за него никто не вошёл.
    //
    // У Telegram две разных проверки. Наша, по hash, считается «по всем
    // полученным полям» — `signature` в их числе. Вторая, для третьих
    // сторон (Ed25519), считается «except hash and signature» — и вот её
    // формулировку легко принять за общее правило. В настоящих данных
    // `signature` есть всегда, поэтому ошибка не проявлялась ни в одном
    // тесте и проявилась у всех сразу.
    const signed = sign({ auth_date: FRESH, user: USER, signature: "Zm9vYmFyLXNpZ25hdHVyZQ" });
    expect(checkInitData(signed, TOKEN, NOW).ok).toBe(true);
  });

  it("но принимает и подпись, посчитанную без signature", () => {
    // Запасной расчёт: так считают некоторые библиотеки, и так считал
    // этот файл до 20.09.2026. Обе строки требуют токена бота, значит
    // замок не слабее; а цена ошибки в эту сторону — снова «не могу
    // войти» и день на выяснение.
    const fields = { auth_date: FRESH, user: USER, signature: "Zm9vYmFyLXNpZ25hdHVyZQ" };
    const withoutSignature = sign({ auth_date: FRESH, user: USER });
    const hash = new URLSearchParams(withoutSignature).get("hash")!;
    const params = new URLSearchParams(fields);
    params.set("hash", hash);
    expect(checkInitData(params.toString(), TOKEN, NOW).ok).toBe(true);
  });

  it("и всё равно не пускает, когда не сходится ни один из расчётов", () => {
    // Два способа посчитать — не повод принять третий. Подделка обязана
    // отлетать при любом из них.
    const params = new URLSearchParams({ auth_date: FRESH, user: USER, signature: "x", hash: "00".repeat(32) });
    expect(checkInitData(params.toString(), TOKEN, NOW).ok).toBe(false);
  });

  it("отказывает, когда токена бота нет", () => {
    expect(checkInitData(sign({ auth_date: FRESH, user: USER }), "", NOW).ok).toBe(false);
  });

  it("отказывает на пустых данных, а не падает", () => {
    expect(checkInitData("", TOKEN, NOW).ok).toBe(false);
  });
});
