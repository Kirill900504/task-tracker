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

// Telegram only gives webhooks a file_id — the actual bytes live on
// Telegram's file servers and need a second round-trip to fetch.
export async function downloadTelegramFile(fileId: string): Promise<ArrayBuffer> {
  const infoRes = await fetch(`${API}/getFile?file_id=${fileId}`);
  const info = await infoRes.json();
  const path = info?.result?.file_path;
  if (!path) throw new Error("Telegram getFile: " + JSON.stringify(info));
  const fileRes = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${path}`);
  return fileRes.arrayBuffer();
}
