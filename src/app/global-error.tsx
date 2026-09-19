"use client";

import { useEffect } from "react";
import { reportCrash } from "@/lib/reportCrash";

// Что человек видит вместо белого экрана.
//
// 19.09.2026 Кирилл дважды получил страницу браузера «This page couldn't
// load» — без единого русского слова, без объяснения и, в установленном
// приложении, без адресной строки, то есть без выхода. Это худший из
// возможных ответов: он не говорит ни что случилось, ни что делать, ни
// пропали ли данные (не пропали — они в облаке).
//
// Next вызывает этот файл, когда падает самый верх дерева, поэтому здесь
// свой <html>: разметки приложения в этот момент уже нет.

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportCrash(error, { where: "экран трекера" });
  }, [error]);

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#232B2E",
          color: "#E8EDEF",
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 460 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 12px" }}>Трекер споткнулся</h1>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: "#A9B6BB", margin: "0 0 10px" }}>
            Задачи, встречи и мысли на месте — они в облаке, и ничего не потерялось. Сломался только экран.
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: "#A9B6BB", margin: "0 0 22px" }}>
            О поломке уже сообщено — разбираться по вашему описанию не придётся.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              font: "inherit",
              fontWeight: 600,
              color: "#232B2E",
              background: "#6FD3C7",
              border: 0,
              borderRadius: 10,
              padding: "11px 22px",
              cursor: "pointer",
            }}
          >
            Открыть заново
          </button>
        </div>
      </body>
    </html>
  );
}
