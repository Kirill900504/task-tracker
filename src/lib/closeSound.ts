// A light «чпок» when the person closes something themselves — a task, a
// meeting with its outcome, a crossed-out thought. Кирилл 15.10.2026: «при
// закрытии задачи, встречи, события был такой звук (в единичной форме, а не
// множественной)». The sample he sent held six pops in a row; public/sounds/
// pop.wav is one of them, cut out and trimmed to a quarter of a second.
//
// Why it is decided HERE, by comparing before and after, and not at each
// button: a task closes through the tick, the swipe, the drag into
// «Завершённые», the card's own controls and the server routes of приёмка
// and принудительное закрытие — a sound wired button by button would be
// missing from whichever door was added next. Everything local goes through
// saveTask / saveMeeting / saveIdea, so the transition is caught once there;
// the two server decisions (approve, force) call playCloseSound themselves,
// only after the server said yes — a pop for a refused приёмка would lie.
//
// «Единичная форма» is also a rule about time: one gesture can close the same
// thing through two paths (the route answers and the tab marks it done too),
// so a second pop inside COOLDOWN_MS is swallowed.
//
// Only the person's OWN action sounds. Realtime echoes and the minute-long
// catch-up do not go through these functions, so a colleague accepting work
// on another screen does not pop here — a sound nobody caused reads as a
// glitch.

import type { Idea, Meeting, Task } from "@/types/tracker";
import { isClosed } from "@/lib/taskDisplay";

const SRC = "/sounds/pop.wav";
const VOLUME = 0.45;
const COOLDOWN_MS = 400;

export function taskJustClosed(before: Task | undefined, after: Task): boolean {
  return !!before && !isClosed(before) && isClosed(after);
}

function meetingClosed(m: Meeting): boolean {
  // A move is not an ending: the meeting goes on under a new date.
  return (m.status === "success" || m.status === "no_result") && !m.movedToDate;
}

export function meetingJustClosed(before: Meeting | undefined, after: Meeting): boolean {
  return !!before && !meetingClosed(before) && meetingClosed(after);
}

export function ideaJustClosed(before: Idea | undefined, after: Idea): boolean {
  return !!before && !before.done && after.done;
}

// Web Audio rather than a bare <audio>: the приёмка pop comes after a network
// round trip, and Safari no longer counts that as part of the tap — an
// <audio>.play() there is refused. An AudioContext unlocked by the first tap
// stays unlocked for the life of the page.
let ctx: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let loading: Promise<void> | null = null;
let lastAt = 0;

function audioCtor(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  return w.AudioContext || w.webkitAudioContext || null;
}

function prepare(): void {
  const Ctor = audioCtor();
  if (!Ctor) return;
  try {
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    if (!buffer && !loading) {
      const c = ctx;
      loading = fetch(SRC)
        .then((r) => r.arrayBuffer())
        .then((b) => c.decodeAudioData(b))
        .then((decoded) => {
          buffer = decoded;
        })
        .catch(() => {
          loading = null;
        });
    }
  } catch {
    // No sound is a fine outcome; a broken click is not.
  }
}

// The first tap anywhere unlocks audio and fetches the sample, so the first
// pop is not the one that has to wait for the file.
if (typeof window !== "undefined") {
  const unlock = () => prepare();
  window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  window.addEventListener("keydown", unlock, { capture: true, passive: true });
}

export function playCloseSound(): void {
  const now = Date.now();
  if (now - lastAt < COOLDOWN_MS) return;
  lastAt = now;
  try {
    prepare();
    if (ctx && buffer && ctx.state === "running") {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = VOLUME;
      src.buffer = buffer;
      src.connect(gain).connect(ctx.destination);
      src.start();
      return;
    }
    if (typeof Audio === "undefined") return;
    const a = new Audio(SRC);
    a.volume = VOLUME;
    void a.play().catch(() => {});
  } catch {
    // see prepare()
  }
}
