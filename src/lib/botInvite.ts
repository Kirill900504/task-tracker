// The link a person opens to connect a chat — the one thing that differs
// between the two messengers in the invite flow, kept in one place so the
// routes stay about permissions rather than about URL formats.

import { maxSettings } from "@/lib/botSettings";

export type InviteChannel = "telegram" | "max";

export function inviteChannel(value: unknown): InviteChannel {
  return value === "max" ? "max" : "telegram";
}

// Async because of MAX alone: its bot is connected from inside the tracker
// and its name is stored in the database (see botSettings.ts), so nothing
// can answer this from process.env alone any more.
export async function botUsername(channel: InviteChannel): Promise<string> {
  if (channel === "max") {
    const settings = await maxSettings();
    return settings?.username || "";
  }
  return process.env.TELEGRAM_BOT_USERNAME || "";
}

// Both messengers carry the code the same way — as a `start` payload on a
// link to the bot: https://t.me/bot?start=CODE, https://max.ru/bot?start=CODE.
export async function inviteLink(channel: InviteChannel, code: string): Promise<string> {
  const username = await botUsername(channel);
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
