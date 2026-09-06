"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Idea, Meeting, Section, Task } from "@/types/tracker";
import { buildJson, exportFileName, ideasCsv, meetingsCsv, tasksCsv } from "@/lib/exportData";

// "Выгрузить" in the header: everything as JSON, or one list as CSV for a
// spreadsheet. The menu is portalled to <body> for the usual reason — the
// header sits inside a container-type element, which would otherwise trap a
// fixed-position child.
export default function ExportMenu({
  tasks,
  meetings,
  ideas,
  sections,
  assignees,
}: {
  tasks: Task[];
  meetings: Meeting[];
  ideas: Idea[];
  sections: Section[];
  assignees: string[];
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function toggle() {
    const rect = buttonRef.current?.getBoundingClientRect() ?? null;
    setAnchor(rect);
    setOpen((v) => !v);
  }

  function download(content: string, fileName: string, mime: string) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    // Revoked on the next tick: the click has already started the download,
    // and holding the object URL any longer just leaks the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setOpen(false);
  }

  return (
    <>
      <button className="btn" id="exportBtn" ref={buttonRef} title="Выгрузить данные" onClick={toggle}>
        ⤓ Выгрузить
      </button>
      {open &&
        anchor &&
        createPortal(
          <>
            <div className="export-backdrop" onClick={() => setOpen(false)} />
            <div className="export-menu" id="exportMenu" style={{ top: anchor.bottom + 6, right: Math.max(8, window.innerWidth - anchor.right) }}>
              <button
                className="export-item"
                onClick={() =>
                  download(buildJson({ tasks, meetings, ideas, sections, assignees }), exportFileName("всё", "json"), "application/json")
                }
              >
                Всё одним файлом (JSON)
              </button>
              <div className="export-sep">Для таблиц (CSV)</div>
              <button className="export-item" onClick={() => download(tasksCsv(tasks, sections), exportFileName("задачи", "csv"), "text/csv")}>
                Задачи
              </button>
              <button className="export-item" onClick={() => download(meetingsCsv(meetings), exportFileName("встречи", "csv"), "text/csv")}>
                Встречи
              </button>
              <button className="export-item" onClick={() => download(ideasCsv(ideas), exportFileName("мысли", "csv"), "text/csv")}>
                Мысли
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
