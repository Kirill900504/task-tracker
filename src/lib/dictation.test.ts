import { describe, expect, it } from "vitest";
import { resamplePcm, toInt16 } from "./dictation";

// Звук, уехавший на расшифровку испорченным, не падает и ничем себя не
// выдаёт: Whisper слышит кашу и отвечает правдоподобной фразой, которой не
// было. Поэтому проверяется именно то, что превращает записанное в
// отправленное — и проверяется цифрами, а не глазами.

// Float32 обратно из Int16 — ровно так, как это делает /api/speech.
function backToFloat(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

function tone(seconds: number, rate: number, hz: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / rate) * 0.5;
  return out;
}

describe("toInt16", () => {
  it("оставляет тишину тишиной", () => {
    const out = toInt16(new Float32Array(64));
    expect([...out].every((v) => v === 0)).toBe(true);
  });

  it("возвращает почти тот же звук после обратного перевода", () => {
    const src = tone(0.1, 16000, 440);
    const back = backToFloat(toInt16(src));
    // Шаг квантования — 1/32768, и при округлении ошибка обязана
    // укладываться в его половину. Больше — значит множитель разошёлся с
    // тем, которым маршрут переводит обратно, или потерян знак.
    const worst = Math.max(...[...src].map((v, i) => Math.abs(v - back[i])));
    expect(worst).toBeLessThanOrEqual(0.5 / 32768);
  });

  it("не переворачивает самый громкий отрицательный отсчёт", () => {
    // Диапазон Int16 несимметричен: −1.0 ложится ровно в дно, а +1.0 в
    // потолок не влезает и обязан быть придержан. Проверяется край,
    // потому что ломается именно он.
    const out = toInt16(new Float32Array([-1, 1, -1.5, 1.5]));
    expect(out[0]).toBe(-32768);
    expect(out[1]).toBe(32767);
    // За пределами диапазона звук обрезается, а не заворачивается: иначе
    // громкий хлопок превращается в треск на всю запись.
    expect(out[2]).toBe(-32768);
    expect(out[3]).toBe(32767);
  });
});

describe("resamplePcm", () => {
  it("не трогает звук, который уже нужной частоты", () => {
    const src = tone(0.05, 16000, 300);
    expect(resamplePcm(src, 16000, 16000)).toBe(src);
  });

  it("сохраняет ДЛИТЕЛЬНОСТЬ при пересчёте частоты", () => {
    // Это главное: ошибка в сторону длины даёт речь, ускоренную или
    // замедленную вдвое, — Whisper её не узнаёт вовсе, а выглядит это как
    // «диктовка пишет ерунду».
    const src = tone(0.5, 48000, 440);
    const out = resamplePcm(src, 48000, 16000);
    expect(out.length).toBe(8000);
  });

  it("сохраняет саму волну, а не только её длину", () => {
    // Синус на 440 Гц обязан остаться синусом на 440 Гц: считаем переходы
    // через ноль — их число не зависит от частоты дискретизации.
    const crossings = (pcm: Float32Array) => {
      let n = 0;
      for (let i = 1; i < pcm.length; i++) if (pcm[i - 1] < 0 !== pcm[i] < 0) n++;
      return n;
    };
    const src = tone(1, 48000, 440);
    const out = resamplePcm(src, 48000, 16000);
    expect(Math.abs(crossings(out) - crossings(src))).toBeLessThanOrEqual(2);
  });
});
