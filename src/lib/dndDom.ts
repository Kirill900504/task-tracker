// Shared DOM-measurement helper for the app's insertion-line drag-and-drop
// (task columns, dashboard panels, idea drop targets) — ported verbatim
// from legacy-tracker.js's getDragAfterElement(). Finds which child the
// pointer is currently above the midpoint of, so the caller can draw an
// insertion line and compute the drop index. Not unit-testable in the
// usual sense (it reads live layout via getBoundingClientRect), so it's
// exercised through manual/e2e testing instead.
export function getDragAfterElement(container: HTMLElement, y: number, selector: string): HTMLElement | null {
  const els = Array.from(container.querySelectorAll<HTMLElement>(selector));
  let closestOffset = -Infinity;
  let closest: HTMLElement | null = null;
  for (const child of els) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = child;
    }
  }
  return closest;
}
