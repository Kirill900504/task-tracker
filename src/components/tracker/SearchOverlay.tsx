"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Idea, Meeting, Task } from "@/types/tracker";
import { searchAll, KIND_LABELS, type SearchResult } from "@/lib/localSearch";
import Modal from "./Modal";
import { useCommentSearch } from "@/hooks/useCommentSearch";

// Global search: "/" anywhere, type, ↑↓ to pick, Enter to open. Results come
// from the data already in memory, so the list narrows on every keystroke
// with nothing to wait for.
//
// Portalled to <body> for the same reason the modals are: .dash-panel sets
// container-type, which would otherwise make it the containing block for a
// position:fixed overlay and trap it inside the panel.
export default function SearchOverlay({
  tasks,
  meetings,
  ideas,
  onClose,
  onOpenResult,
}: {
  tasks: Task[];
  meetings: Meeting[];
  ideas: Idea[];
  onClose: () => void;
  onOpenResult: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const own = useMemo(() => searchAll(query, { tasks, meetings, ideas }), [query, tasks, meetings, ideas]);
  // Реплики ищутся в базе и приезжают позже остальных: их тысячи, в память
  // они не тянутся, и держать их там ради вопроса, который задают раз в
  // неделю, значило бы платить памятью за удобство, которого никто не
  // просил.
  const { results: said, searching } = useCommentSearch(query);
  // Один плоский список — чтобы стрелки работали одинаково по всему окну.
  // Реплики идут последними: сначала то, что искали, потом то, что о нём
  // говорили.
  const results = useMemo(() => [...own, ...said.map((r) => ({ ...r, said: true }))], [own, said]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc from anywhere, not only from inside the box — a click on a result
  // row can take focus out of the input, and the key has to keep working.

  // A shorter list can leave the stored cursor pointing past the end;
  // clamping it where it is read keeps that from needing its own state
  // update (and the extra render that comes with it).
  const active = results.length ? Math.min(cursor, results.length - 1) : 0;

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector(".search-hit.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length) setCursor((active + 1) % results.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) setCursor((active - 1 + results.length) % results.length);
      return;
    }
    if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      onOpenResult(results[active]);
    }
  }


  return (
    <Modal id="searchOverlay" onClose={onClose}>
      <div className="search-modal" onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          id="searchInput"
          type="text"
          className="search-input"
          placeholder="Поиск по задачам, встречам и мыслям…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          autoComplete="off"
        />
        <div className="search-results" ref={listRef}>
          {!query.trim() && <div className="search-empty">Начните печатать. ↑↓ — выбрать, Enter — открыть, Esc — закрыть.</div>}
          {query.trim() && results.length === 0 && !searching && <div className="search-empty">Ничего не нашлось</div>}
          {searching && results.length === 0 && <div className="search-empty">Ищу и в обсуждениях…</div>}
          {results.map((r, i) => {
            // One flat list keeps the keyboard cursor simple; a group header is
            // rendered wherever the kind changes.
            // Заголовок группы — там, где меняется вид. У реплик он свой:
            // это не задачи, и мешать их в один список значило бы заставлять
            // читать «что это» на каждой строке.
            const prev = results[i - 1] as (typeof results)[number] | undefined;
            const isSaid = "said" in r && r.said;
            const wasSaid = prev && "said" in prev && prev.said;
            const header = isSaid
              ? i === 0 || !wasSaid
                ? "В обсуждениях"
                : null
              : i === 0 || prev!.kind !== r.kind
                ? KIND_LABELS[r.kind]
                : null;
            return (
              <div key={(isSaid ? "c" : "") + r.kind + r.id + i}>
                {header && <div className="search-group">{header}</div>}
                <div
                  className={"search-hit" + (i === active ? " active" : "") + (r.done ? " done" : "") + (isSaid ? " said" : "")}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => onOpenResult(r)}
                >
                  <span className="search-hit-title">{r.title}</span>
                  {r.meta && <span className="search-hit-meta">{r.meta}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
