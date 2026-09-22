#!/usr/bin/env node
// Who is holding which files right now.
//
// Кирилл открывает несколько чатов сразу, и это не две ветки и не два
// клона: один каталог, один git status, одно дерево на всех. 18.09.2026
// две сессии правили его одновременно и разошлись во всём, что могло
// разойтись — одна вклинила свой useEffect внутрь чужого комментария,
// разорвав фразу пополам; вторая не смогла закоммитить свой файл, потому
// что он импортировал функцию из чужого незакоммиченного. 22.09.2026
// повторилось мягче: соседняя сессия поправила файл теста, который в эту
// минуту писала другая.
//
// Правило «объявите файлы, прежде чем их трогать» с тех пор записано в
// CLAUDE.md, и его нечем было исполнить: объявление жило в сообщении,
// которого вторая сессия не видела. Этот файл — то место, где объявление
// видно всем: общий журнал на диске, рядом с деревом, которое они делят.
//
// Он НЕ запрещает и не блокирует. Запрет здесь был бы хуже болезни: файл,
// забытый в захвате, остановил бы работу, а выйти из этого было бы нечем
// (то же возражение, что у Кирилла к кнопке «Сбросить расположение» —
// прежде чем страховать конструктор, почините конструктор). Поэтому он
// только ОТВЕЧАЕТ: занят ли файл, кем и как давно. Решает сессия.
//
//   node scripts/claim.mjs take "правка ролей" src/a.ts src/b.css
//   node scripts/claim.mjs list
//   node scripts/claim.mjs drop "правка ролей"
//
// Журнал лежит в .unfinished/claims.json — вне git нарочно: он описывает
// сиюминутное состояние машины, а не историю проекта.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const journal = resolve(root, ".unfinished", "claims.json");

// Захват живёт четыре часа. Сессия кончается молча — её обрывают на
// лимите, её закрывают, компьютер засыпает, — и «отпустить» за неё
// некому. Срок годности здесь не украшение, а единственное, что не даёт
// журналу превратиться в список вечно занятых файлов.
const LIVE_MS = 4 * 60 * 60 * 1000;

function read() {
  if (!existsSync(journal)) return [];
  try {
    const all = JSON.parse(readFileSync(journal, "utf8"));
    return Array.isArray(all) ? all.filter((c) => Date.now() - Date.parse(c.at) < LIVE_MS) : [];
  } catch {
    // Журнал пишут несколько процессов сразу, и порванный файл не повод
    // останавливать работу: он описывает намерения, а не данные.
    return [];
  }
}

function write(all) {
  mkdirSync(dirname(journal), { recursive: true });
  writeFileSync(journal, JSON.stringify(all, null, 2) + "\n", "utf8");
}

// Пути сравниваются в одном виде: сессия напишет и "src/a.ts", и
// "./src/a.ts", и абсолютный путь с обратными слэшами — это один файл.
function normalize(p) {
  return relative(root, resolve(root, p)).split("\\").join("/");
}

function ago(at) {
  const minutes = Math.round((Date.now() - Date.parse(at)) / 60000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин назад`;
}

const [, , command, label, ...paths] = process.argv;
const all = read();

if (command === "take") {
  if (!label || !paths.length) {
    console.error('Как звать: node scripts/claim.mjs take "чем занята сессия" <файлы...>');
    process.exit(1);
  }
  const files = paths.map(normalize);
  const clashes = [];
  for (const claim of all) {
    if (claim.label === label) continue;
    for (const file of claim.files) if (files.includes(file)) clashes.push({ file, claim });
  }

  // Объявление записывается В ЛЮБОМ случае, даже когда файл занят: две
  // сессии, знающие друг о друге, договорятся, а сессия, чьё объявление
  // потерялось, снова станет невидимой — с чего всё и началось.
  write([...all.filter((c) => c.label !== label), { label, files, at: new Date().toISOString() }]);

  if (clashes.length) {
    console.log("ЗАНЯТО — это чужие файлы, и трогать их нельзя:");
    for (const { file, claim } of clashes) console.log(`  ${file} — «${claim.label}», ${ago(claim.at)}`);
    console.log("Напишите той сессии или возьмите другую часть работы.");
    process.exit(2);
  }
  console.log(`Взято (${files.length}): ${files.join(", ")}`);
  process.exit(0);
}

if (command === "list") {
  if (!all.length) {
    console.log("Никто ничего не держит.");
    process.exit(0);
  }
  for (const claim of all) {
    console.log(`«${claim.label}» — ${ago(claim.at)}`);
    for (const file of claim.files) console.log(`    ${file}`);
  }
  process.exit(0);
}

if (command === "drop") {
  if (!label) {
    console.error('Как звать: node scripts/claim.mjs drop "чем занята сессия"');
    process.exit(1);
  }
  write(all.filter((c) => c.label !== label));
  console.log(`Отпущено: «${label}»`);
  process.exit(0);
}

console.error("Команды: take <метка> <файлы...> | list | drop <метка>");
process.exit(1);
