// Pure idea-list ordering, ported from legacy-tracker.js's renderIdeas():
// hides done ideas unless showDone is set, newest-first, with done ideas
// (when shown) sorted after active ones.
import type { Idea } from "@/types/tracker";

export function sortIdeasForList(ideas: Idea[], showDone: boolean): Idea[] {
  const visible = ideas.filter((i) => showDone || !i.done);
  return visible
    .slice()
    .reverse()
    .sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
}
