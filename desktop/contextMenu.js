"use strict";

// Right-click menu for the desktop window.
//
// A browser tab gets this from Chrome for free; an Electron window gets
// nothing at all. Spellcheck was on (webPreferences.spellcheck), so words were
// underlined red — and a right click on one did nothing, because Electron only
// fires `context-menu` and leaves the menu to the app. Кирилл 30.10.2026: «при
// нажатии правой кнопки мыши предлагались варианты исправлений».
//
// The page's own menus are unaffected: the chat bubble menu calls
// preventDefault on contextmenu, and Chromium then never asks the window for
// one. So this only appears where the site has nothing of its own — text
// fields and selected text — and nowhere else, as before.
//
// Pure function of the click so smoke.mjs can check it without a window.

const MAX_SUGGESTIONS = 6;

function contextMenuTemplate(params, act) {
  const items = [];
  const flags = params.editFlags || {};

  if (params.isEditable && params.misspelledWord) {
    const suggestions = (params.dictionarySuggestions || []).slice(0, MAX_SUGGESTIONS);
    for (const word of suggestions) {
      items.push({ label: word, click: () => act.replace(word) });
    }
    if (!suggestions.length) items.push({ label: "Нет вариантов", enabled: false });
    items.push({ type: "separator" });
    items.push({ label: "Добавить в словарь", click: () => act.learn(params.misspelledWord) });
    items.push({ type: "separator" });
  }

  if (params.isEditable) {
    items.push({ label: "Вырезать", role: "cut", enabled: !!flags.canCut });
    items.push({ label: "Копировать", role: "copy", enabled: !!flags.canCopy });
    items.push({ label: "Вставить", role: "paste", enabled: !!flags.canPaste });
    items.push({ type: "separator" });
    items.push({ label: "Выделить всё", role: "selectAll", enabled: flags.canSelectAll !== false });
  } else if (params.selectionText && params.selectionText.trim()) {
    items.push({ label: "Копировать", role: "copy" });
  }

  return items;
}

function attachContextMenu(win, Menu) {
  win.webContents.on("context-menu", (_event, params) => {
    const template = contextMenuTemplate(params, {
      replace: (word) => win.webContents.replaceMisspelling(word),
      learn: (word) => win.webContents.session.addWordToSpellCheckerDictionary(word),
    });
    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

module.exports = { contextMenuTemplate, attachContextMenu };
