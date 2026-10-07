// What is finished but not on production yet.
//
// 07.10.2026 a session twice left a day of committed work in its own
// branch: green, committed, and never merged — so production went on
// without it until another session happened to look. CLAUDE.md already
// said "merge into main the moment the checks are green"; what was missing
// was a check that answers the question in one line instead of relying on
// every session to remember it. Run this before you say "готово".
//
//   node scripts/unmerged.mjs
//
// Exit code 1 when something is waiting, so it can be chained.

import { execSync } from "node:child_process";

const git = (cmd) => execSync(`git ${cmd}`, { encoding: "utf8" }).trim();

try {
  git("fetch -q origin");
} catch {
  console.log("⚠ Не удалось связаться с GitHub — сверяю с последней известной копией main.");
}

const branch = git("branch --show-current") || "(detached)";
const ahead = git("log --oneline origin/main..HEAD");
const dirty = git("status --short");

let waiting = false;
if (ahead) {
  waiting = true;
  const n = ahead.split("\n").length;
  console.log(`✗ В ветке ${branch} ${n} коммит(ов), которых нет в main — на боевом их НЕТ:`);
  console.log(ahead.replace(/^/gm, "    "));
  const ff = (() => {
    try {
      git("merge-base --is-ancestor origin/main HEAD");
      return true;
    } catch {
      return false;
    }
  })();
  console.log(
    ff
      ? "  Если это ваша законченная работа: npm test, npm run lint, npm run build — и git push origin HEAD:main."
      : "  main ушёл вперёд: сначала влейте origin/main в ветку, прогоните проверки, затем git push origin HEAD:main.",
  );
}
if (dirty) {
  waiting = true;
  console.log("✗ Незакоммиченные файлы (в общем дереве часть может быть чужой — сверьтесь с node scripts/claim.mjs list):");
  console.log(dirty.replace(/^/gm, "    "));
}
if (!waiting) console.log(`✓ Всё в main: ветка ${branch}, незакоммиченного нет.`);
process.exit(waiting ? 1 : 0);
