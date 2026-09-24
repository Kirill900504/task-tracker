"use client";

// Значок связи в шапке — вместо баннера на пол-экрана.
//
// До 24.09.2026 «нет связи» и «не всё сохранилось» были плашками в потоке
// страницы и плавающими карточками поверх доски — на телефоне это читалось
// как «трекер сломан», а не как «данные подождут сеть» (Кирилл — «замучали
// эти ошибки… выводи аккуратными значками в шапке, а не текстом на пол
// экрана»). Теперь оба состояния — маленькие кнопки рядом с остальными
// кнопками шапки: значок виден всегда, а подробности — по нажатию, тем же
// текстом, что раньше стоял в баннере.
//
// Два значка, а не один на оба смысла: «сейчас нет связи» и «однажды не
// сохранилось» — разные факты (первый исчезает сам, как только связь
// вернётся; второй остаётся, пока не отпустят руками), и путать их в одном
// значке значило бы стирать то различие, ради которого они вообще разведены
// в разных таблицах (offline — состояние сессии, sync_errors — база).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import PopLayer from "./PopLayer";
import Icon from "./Icon";

// Строка, из которой ничего не следует — «[object Object]», отказ базы,
// потерянный по дороге сюда до того, как syncError.ts начал разбирать его
// по полям. Такие строки в базе уже лежат, и показывать их как есть значит
// пугать человека тем, чего он всё равно не прочитает.
function unreadable(message: string): boolean {
  const text = (message || "").trim();
  return !text || /^\[object .*\]$/i.test(text);
}

type Open = "offline" | "errors" | null;

export default function ConnectionStatus({ offline }: { offline: boolean }) {
  const [errors, setErrors] = useState<{ ids: string[]; count: number; message: string } | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const offlineBtnRef = useRef<HTMLButtonElement | null>(null);
  const errorBtnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const db = createClient();
    db.from("sync_errors")
      .select("id, message, created_at")
      .eq("acknowledged", false)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (cancelled || error || !data || !data.length) return;
        setErrors({ ids: data.map((r) => r.id as string), count: data.length, message: (data[0].message as string) || "" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEscapeToClose(() => setOpen(null), open !== null);

  // Позиционирование — тем же приёмом, что у ActionMenu: измеряем после
  // отрисовки и переворачиваем вверх, если снизу не хватает места, чтобы
  // значок у самого правого края шапки не открывал меню за пределы экрана.
  useLayoutEffect(() => {
    const el = popRef.current;
    const btn = open === "offline" ? offlineBtnRef.current : open === "errors" ? errorBtnRef.current : null;
    if (!el || !btn) return;
    const anchor = btn.getBoundingClientRect();
    let top = anchor.bottom + 8;
    if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, anchor.top - el.offsetHeight - 8);
    el.style.top = top + "px";
    el.style.right = Math.max(8, window.innerWidth - anchor.right) + "px";
  }, [open]);

  if (!offline && !errors) return null;

  function dismissErrors() {
    if (!errors) return;
    const db = createClient();
    db.from("sync_errors").update({ acknowledged: true }).in("id", errors.ids).then(() => {});
    setErrors(null);
    setOpen(null);
  }

  return (
    <>
      {offline && (
        <button
          type="button"
          id="connOfflineBtn"
          className="btn btn-icon conn-status-btn conn-status-offline"
          ref={offlineBtnRef}
          title="Нет связи с облаком — показываю сохранённую копию"
          aria-label="Нет связи с облаком"
          onClick={() => setOpen((v) => (v === "offline" ? null : "offline"))}
        >
          <Icon name="cloud-off" size={15} />
        </button>
      )}
      {errors && (
        <button
          type="button"
          id="connErrorBtn"
          className="btn btn-icon conn-status-btn conn-status-error"
          ref={errorBtnRef}
          title={`Не всё сохранилось в облако (${errors.count})`}
          aria-label="Не всё сохранилось в облако"
          onClick={() => setOpen((v) => (v === "errors" ? null : "errors"))}
        >
          <Icon name="warning" size={15} />
          {errors.count > 1 && <span className="conn-status-badge">{errors.count}</span>}
        </button>
      )}
      {open && (
        <PopLayer>
          <div className="export-backdrop" onClick={() => setOpen(null)} />
          <div ref={popRef} className="export-menu conn-status-pop" style={{ top: -9999, right: 8 }}>
            {open === "offline" ? (
              <p className="conn-status-text">
                Нет связи с облаком — показываю сохранённую копию. Всё, что записываете, отправится, как только связь вернётся.
              </p>
            ) : (
              errors && (
                <>
                  <p className="conn-status-text">
                    Не всё сохранилось в облако ({errors.count}):{" "}
                    {unreadable(errors.message)
                      ? "что именно отказало, в тот раз не записалось. Если повторится — здесь будет написано, какая таблица и почему."
                      : errors.message}
                  </p>
                  <button className="btn btn-small" onClick={dismissErrors}>
                    Скрыть
                  </button>
                </>
              )
            )}
          </div>
        </PopLayer>
      )}
    </>
  );
}
