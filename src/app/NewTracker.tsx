"use client";

// Phase 1 scaffold for the React rewrite (see the approved migration plan).
// Deliberately minimal — just proves useTrackerData() loads real data and
// the sync/retry/sign-out machinery works end-to-end. The actual task/
// meeting/idea/calendar UI comes in later phases; this is not meant to be
// used day-to-day yet.

import { useTrackerData } from "@/hooks/useTrackerData";

export default function NewTracker() {
  const { loading, loadError, tasks, meetings, ideas, assignees, sections, syncStatus, actions } = useTrackerData();

  if (loadError) {
    return <div style={{ padding: 24 }}>Не удалось загрузить данные из облака: {loadError}</div>;
  }
  if (loading) {
    return <div style={{ padding: 24 }}>Загрузка…</div>;
  }

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif", color: "#eee", background: "#232B2E", minHeight: "100vh" }}>
      <h1>Новый интерфейс — Фаза 1 (черновик данных)</h1>
      <p>
        Статус синхронизации:{" "}
        {syncStatus.pending ? "Сохраняю…" : syncStatus.lastError ? `⚠ ${syncStatus.lastError}` : "✓ Сохранено"}
      </p>
      <ul>
        <li>Задачи: {tasks.length}</li>
        <li>Встречи: {meetings.length}</li>
        <li>Идеи: {ideas.length}</li>
        <li>Исполнители: {assignees.length}</li>
        <li>Разделы: {sections.length}</li>
      </ul>
      <button
        onClick={() => {
          actions.signOut();
        }}
      >
        Выйти
      </button>
    </div>
  );
}
