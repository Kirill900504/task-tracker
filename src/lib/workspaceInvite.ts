// Getting a manager into the tracker.
//
// There is no sign-up form anywhere in this application, and there is not
// going to be one: a person exists here because Кирилл added him. The whole
// of registration is this — the owner produces a link for a name that is
// already in his list of people, hands it over, and the person opening it
// sets himself a password. That is why the code below is the only door, and
// why it is worth being careful with.
//
// It is deliberately not the same code as the messenger invite
// (`botInvite.randomCode`). That one is eight characters because it gets read
// aloud and retyped into a chat; this one is only ever clicked, and it opens
// an account rather than a chat — so it is long enough that guessing it is
// not a strategy.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomInviteCode(): string {
  // 32 letters divides 256 exactly, so mapping a random byte onto the
  // alphabet is uniform — no modulo bias to reason about later.
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function joinLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/join?code=${code}`;
}

export function inviteExpired(expiresAt: string, now: Date = new Date()): boolean {
  const at = Date.parse(expiresAt);
  // An unparseable timestamp is treated as expired: the failure mode of
  // "nobody can join" is recoverable, the other one is not.
  if (Number.isNaN(at)) return true;
  return at <= now.getTime();
}

// The messages are what the person actually sees, so they are written as
// instructions rather than as complaints.
export function emailProblem(email: string): string {
  const value = email.trim();
  if (!value) return "Укажите почту";
  // Not a full RFC check on purpose — the address is confirmed by being
  // able to sign in with it, and an over-strict regex rejects real people.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Похоже, в адресе опечатка";
  return "";
}

export function passwordProblem(password: string): string {
  if (password.length < 8) return "Пароль короче 8 символов — так не пойдёт";
  if (/^\d+$/.test(password)) return "Пароль из одних цифр слишком просто подобрать";
  return "";
}
