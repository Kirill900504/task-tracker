// Рабочий телефон из личного кабинета — в одном виде, «+7 900 123-45-67».
//
// Люди пишут номер как привыкли: «8 (900) 123 45 67», «+79001234567»,
// «9001234567». Хранится один вид, иначе один и тот же номер в «Команде»
// выглядит тремя разными, а ссылка tel: с пробелами и скобками на части
// телефонов не набирается. Российский номер узнаётся и приводится; чужой
// (с другим кодом страны) сохраняется цифрами с плюсом, без разметки.

export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/[^\d\s()+\-.]/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("9")) digits = "7" + digits;
  if (digits.length === 11 && digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (digits.length === 11 && digits.startsWith("7")) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return "+" + digits;
  return null;
}

// The field as it is being typed (30.10.2026: «при заполнении телефона
// сделай сразу +7… даже если вводят первую цифру 8, переделывай её на +7»).
// A Russian number is shown as «+7 900 123-45-67» while it grows, with no
// trailing separator so Backspace deletes a digit rather than a space. A
// leading 8 (and a pasted «89897201133») becomes 7, a bare ten-digit «989…»
// gets 7 in front. A paste on top of the «+7 » the field starts with arrives
// as «+7 8989…» — twelve digits — so the extra leading 7 is dropped first,
// but only when the field held nothing more than that prefix (`prev`): a
// digit typed past the end of a full «+7 800 …» is simply cut off, or the
// 8 of «800» would turn into 7.
// A number that starts with «+» and another country code is left alone:
// normalizePhone still accepts those.
export function typePhone(raw: string, prev = ""): string {
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.trim().startsWith("+") && !/^[78]/.test(digits)) return raw;
  if (digits.length > 11 && digits.startsWith("7") && prev.replace(/\D/g, "").length <= 1) digits = digits.slice(1);
  if (digits.startsWith("8")) digits = "7" + digits.slice(1);
  else if (!digits.startsWith("7")) digits = "7" + digits;
  const d = digits.slice(1, 11);
  let out = "+7";
  if (d) out += " " + d.slice(0, 3);
  if (d.length > 3) out += " " + d.slice(3, 6);
  if (d.length > 6) out += "-" + d.slice(6, 8);
  if (d.length > 8) out += "-" + d.slice(8, 10);
  return out;
}

// Only the prefix the field put there itself — not a number at all.
export function isBarePhonePrefix(value: string): boolean {
  return /^\+7\s*$/.test(value.trim());
}

// Для ссылки tel: — только плюс и цифры.
export function phoneHref(phone: string): string {
  return "tel:" + phone.replace(/[^\d+]/g, "");
}
