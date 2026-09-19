import { describe, it, expect } from "vitest";
import { forgotPasswordInput, reportInput, reviewInput } from "@/lib/apiInput";

describe("схема отчёта", () => {
  it("принимает нормальный отчёт", () => {
    const parsed = reportInput.safeParse({ action: "done", comment: "сделал", participantId: crypto.randomUUID() });
    expect(parsed.success).toBe(true);
  });

  it("не принимает выдуманное действие", () => {
    expect(reportInput.safeParse({ action: "стереть всё" }).success).toBe(false);
  });

  it("не принимает дату словом — именно это раньше проходило насквозь", () => {
    expect(reportInput.safeParse({ action: "reschedule", date: "завтра" }).success).toBe(false);
    expect(reportInput.safeParse({ action: "reschedule", date: "2026-10-01" }).success).toBe(true);
  });
});

describe("схема приёмки", () => {
  it("требует задачу", () => {
    expect(reviewInput.safeParse({ action: "approve" }).success).toBe(false);
    expect(reviewInput.safeParse({ action: "approve", taskId: "tmu8a554gkjlii" }).success).toBe(true);
  });

  it("различает «снять срок» и «не трогать»", () => {
    // null значимо: это «срока больше нет», а не отсутствие поля.
    expect(reviewInput.safeParse({ action: "deadline", taskId: "t1", date: null }).success).toBe(true);
    expect(reviewInput.safeParse({ action: "deadline", taskId: "t1" }).success).toBe(true);
  });
});

describe("схема «забыли пароль»", () => {
  it("приводит почту к нижнему регистру и отсекает не-почту", () => {
    const ok = forgotPasswordInput.safeParse({ email: "  Igor@Example.RU " });
    expect(ok.success && ok.data.email).toBe("igor@example.ru");
    expect(forgotPasswordInput.safeParse({ email: "игорь" }).success).toBe(false);
    // А кириллический адрес — это адрес: встроенная проверка zod его
    // отвергала, и на этом падал сценарий рабочего пространства.
    expect(forgotPasswordInput.safeParse({ email: "нет-такой@example.invalid" }).success).toBe(true);
  });
});
