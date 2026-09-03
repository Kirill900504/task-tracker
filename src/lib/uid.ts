// Same id scheme as legacy-tracker.js's uid()/webhook route's uid() — kept
// identical so ids created by the new UI, the old UI, and the Telegram bot
// are indistinguishable and never collide (base36 timestamp + 5 random
// chars, ~2 billion combinations per millisecond).
export function uid(): string {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
