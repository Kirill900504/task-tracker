"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Idea, Meeting, Task } from "@/types/tracker";
import { searchAll, KIND_LABELS, type SearchResult } from "@/lib/localSearch";

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

  const results = useMemo(() => searchAll(query, { tasks, meetings, ideas }), [query, tasks, meetings, ideas]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc from anywhere, not only from inside the box — a click on a result
  // row can take focus out of the input, and the key has to keep working.
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

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


  return createPortal(
    <div className="overlay open" id="searchOverlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
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
          {query.trim() && results.length === 0 && <div className="search-empty">Ничего не нашлось</div>}
          {results.map((r, i) => {
            // One flat list keeps the keyboard cursor simple; a group header is
            // rendered wherever the kind changes.
            const header = i === 0 || results[i - 1].kind !== r.kind ? KIND_LABELS[r.kind] : null;
            return (
              <div key={r.kind + r.id}>
                {header && <div className="search-group">{header}</div>}
                <div
                  className={"search-hit" + (i === active ? " active" : "") + (r.done ? " done" : "")}
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
    </div>,
    document.body,
  );
}
