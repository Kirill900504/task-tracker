import { isSelfAssignee } from "@/lib/trackerRows";

// Who an item can be sent to, and how the answer reads afterwards.
//
// Sending used to be an all-or-nothing button: a task went to its assignee,
// a meeting to its participants, and if the person you actually wanted was
// neither, there was no way to reach them from the tracker at all. So the
// menu now offers everyone who is connected to a messenger — with the people
// the item already concerns at the top, because that is who it is usually
// for, and one tap should still be enough for that case.

export type SendTarget = { name: string; suggested: boolean };

// `concerns` is the assignee of a task or the participants of a meeting —
// a thought concerns nobody in particular and simply passes an empty list.
export function sendTargets(linked: string[], concerns?: string[]): SendTarget[] {
  const reachable = linked.filter((name) => name && !isSelfAssignee(name));
  const suggested = (concerns || []).filter((name) => reachable.includes(name));
  return [
    ...suggested.map((name) => ({ name, suggested: true })),
    ...reachable.filter((name) => !suggested.includes(name)).map((name) => ({ name, suggested: false })),
  ];
}

// The people this item is addressed to who are not in any messenger. Worth
// saying out loud: "отправлено: никому" reads like a failure of the tracker,
// "Петров не подключён" reads like something you can fix.
export function unreachableNames(linked: string[], concerns?: string[]): string[] {
  return (concerns || []).filter((name) => name && !isSelfAssignee(name) && !linked.includes(name));
}

export function sendResultText(result: { sentTo: string[]; failed: string[] }): string {
  const sent = result.sentTo.join(", ");
  const failed = result.failed.join(", ");
  if (sent && failed) return `Отправлено: ${sent}; не дошло: ${failed}`;
  if (sent) return `Отправлено: ${sent}`;
  if (failed) return `Не дошло: ${failed}`;
  return "Некому отправлять";
}
