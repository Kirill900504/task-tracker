// Где встать подсказке над элементом (см. app/TitleTips.tsx).
//
// Над элементом по центру; если сверху не помещается — под ним. По
// горизонтали прижимается к краю окна с запасом, а не уезжает за него:
// у кнопок в правом углу шапки (× окна, колокольчик) иначе была бы видна
// только половина текста.

export type Box = { left: number; top: number; width: number; height: number };

export const TIP_GAP = 8;
export const TIP_EDGE = 8;

export function placeTip(target: Box, tip: { width: number; height: number }, viewport: { width: number; height: number }) {
  const above = target.top - TIP_GAP - tip.height;
  const below = target.top + target.height + TIP_GAP;
  const side: "above" | "below" = above >= TIP_EDGE || below + tip.height > viewport.height - TIP_EDGE ? "above" : "below";
  const top = side === "above" ? Math.max(TIP_EDGE, above) : below;
  const centred = target.left + target.width / 2 - tip.width / 2;
  const left = Math.min(Math.max(TIP_EDGE, centred), Math.max(TIP_EDGE, viewport.width - TIP_EDGE - tip.width));
  return { left: Math.round(left), top: Math.round(top), side };
}
