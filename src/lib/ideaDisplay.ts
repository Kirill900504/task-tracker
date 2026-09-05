// Pure idea-list ordering, ported from legacy-tracker.js's renderIdeas():
// hides done ideas unless showDone is set, newest-first, with done ideas
// (when shown) sorted after active ones — and, among those, most recently
// ticked off first, so the one just closed is the first you can un-tick.
import type { Idea } from "@/types/tracker";

export function sortIdeasForList(ideas: Idea[], showDone: boolean): Idea[] {
  const visible = ideas.filter((i) => showDone || !i.done);
  return visible
    .slice()
    .reverse()
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (!a.done) return 0; // active ideas keep the newest-first order above
      // Done ideas without a doneAt (ticked off before that column existed)
      // fall back to the reversed creation order rather than jumping ahead.
      const ad = a.doneAt || "";
      const bd = b.doneAt || "";
      if (ad === bd) return 0;
      return ad > bd ? -1 : 1;
    });
}
