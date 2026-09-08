// The link a person opens to connect a chat — the one thing that differs
// between the two messengers in the invite flow, kept in one place so the
// routes stay about permissions rather than about URL formats.

export type InviteChannel = "telegram" | "max";

export function inviteChannel(value: unknown): InviteChannel {
  return value === "max" ? "max" : "telegram";
}

export function botUsername(channel: InviteChannel): string {
  const max = process.env.MAX_BOT_USERNAME || process.env.NEXT_PUBLIC_MAX_BOT_USERNAME;
  return (channel === "max" ? max : process.env.TELEGRAM_BOT_USERNAME) || "";
}

// Both messengers carry the code the same way — as a `start` payload on a
// link to the bot: https://t.me/bot?start=CODE, https://max.ru/bot?start=CODE.
export function inviteLink(channel: InviteChannel, code: string): string {
  const username = botUsername(channel);
  if (!username) return "";
  const base = channel === "max" ? "https://max.ru/" : "https://t.me/";
  return `${base}${username}?start=${code}`;
}

// A code has to survive being read aloud and retyped: no 0/O/1/I, no
// lowercase, and short enough to fit a deep link comfortably.
export function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
