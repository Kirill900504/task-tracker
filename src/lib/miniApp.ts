"use client";

// Открыт ли трекер внутри мессенджера — один ответ на всех, кто спрашивает.
//
// Признак ставит MiniAppChrome: данные мессенджера приходят один раз, во
// фрагменте адреса первой страницы, и оттуда переезжают в sessionStorage,
// потому что дальше вкладка живёт своей жизнью и фрагмента у неё уже нет.
// Здесь проверяются ОБА источника, и это важно: на первой странице флага
// ещё нет (его пишет эффект, а рисуем мы раньше), а на второй уже нет
// фрагмента. Вместе они дают один и тот же ответ на любом кадре, поэтому
// подписываться не на что — значение не меняется за жизнь вкладки.
import { useSyncExternalStore } from "react";
import { hasMessengerLaunch } from "./messengerLaunch";

// Тот же ключ, которым помечает вкладку MiniAppChrome. Второе написание
// разошлось бы с первым в первый же день.
export const MINI_APP_FLAG = "rokas:miniapp";

export function isMiniApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(MINI_APP_FLAG) === "1") return true;
  } catch {
    // Приватное окно или запрет на хранилище: остаётся фрагмент.
  }
  return hasMessengerLaunch(window.location.hash || "");
}

// Пустая подписка не ошибка, а описание: за жизнь вкладки ответ не
// меняется, менять его некому.
const noSubscribe = () => () => {};

export function useIsMiniApp(): boolean {
  // На сервере мессенджера нет и быть не может: фрагмент адреса туда не
  // уходит вовсе, а sessionStorage там не существует.
  return useSyncExternalStore(noSubscribe, isMiniApp, () => false);
}
