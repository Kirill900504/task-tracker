import type { MeetingRecur } from "@/types/tracker";

// Отдельно от lib/meetingRepeat: тот тянет серверную рассылку, а подписи
// нужны форме встречи в браузере.
export const RECUR_LABELS: Record<MeetingRecur, string> = {
  none: "Один раз",
  weekly: "Каждую неделю",
  biweekly: "Раз в две недели",
  monthly: "Каждый месяц",
};
