// Строка в хронику задачи про смену состава — добавили, убрали или
// переназначили. Сама вставка в task_participants идёт из браузера (RLS
// это позволяет автору задачи), а вот системная строка обсуждения — только
// через маршрут, служебным ключом (см. api/workspace/participant-note).
//
// Фоново и молча: история — это польза, а не обязанность, и уронить само
// изменение состава из-за того, что не записалась строка о нём, было бы
// обменом наоборот. Поэтому promise не ждут — вызывающий продолжает как ни
// в чём не бывало, а неудача просто оставляет хронику чуть менее полной.
export function noteParticipantChange(params: {
  taskId: string;
  assigneeId: string;
  action: "add" | "remove" | "role";
  role?: "executor" | "coexecutor" | "watcher";
}): void {
  void fetch("/api/workspace/participant-note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).catch(() => {
    /* см. комментарий выше — история не обязана дойти */
  });
}
