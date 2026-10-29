import { describe, expect, it } from "vitest";
import { signedInWithPassword } from "./signInMethod";

describe("signedInWithPassword", () => {
  it("видит вход паролем в обеих формах amr", () => {
    expect(signedInWithPassword([{ method: "password" }])).toBe(true);
    expect(signedInWithPassword(["password"])).toBe(true);
  });

  // Вход через бота (magiclink) и по ссылке «новый пароль» — не паролем:
  // у такого человека текущий пароль не спрашивают.
  it("не считает паролем вход через бота или по ссылке", () => {
    expect(signedInWithPassword([{ method: "otp" }])).toBe(false);
    expect(signedInWithPassword([{ method: "recovery" }])).toBe(false);
    expect(signedInWithPassword(null)).toBe(false);
  });
});
