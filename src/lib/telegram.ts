const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

export async function sendTelegramMessage(chatId: number, text: string) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export async function sendTelegramDocument(chatId: number, filename: string, content: string, caption?: string) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([content], { type: "application/json" }), filename);
  await fetch(`${API}/sendDocument`, { method: "POST", body: form });
}
