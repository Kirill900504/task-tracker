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

// Для ссылки tel: — только плюс и цифры.
export function phoneHref(phone: string): string {
  return "tel:" + phone.replace(/[^\d+]/g, "");
}
