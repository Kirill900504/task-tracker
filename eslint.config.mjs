import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // 19.09.2026: `const mine = ...` стоял на девяносто строк ниже строки,
      // которая звала его прямо в теле компонента. TypeScript промолчал,
      // линтер промолчал, 392 теста промолчали — а трекер переставал
      // открываться у любого, у кого есть хоть одна задача, потому что до
      // своей строки `const` лежит во временной мёртвой зоне. Стоило это
      // половины дня втроём и сломанной боевой версии.
      //
      // `functions: false` — объявленные функции поднимаются целиком и
      // звать их выше объявления совершенно законно; здесь на этом держится
      // читаемость половины компонентов. Ловим именно переменные, включая
      // стрелочные функции в `const`, — то есть ровно тот случай, который
      // ломается молча.
      "no-use-before-define": "off",
      "@typescript-eslint/no-use-before-define": [
        "error",
        { functions: false, classes: true, variables: true, typedefs: false, enums: true, ignoreTypeReferences: true },
      ],
    },
  },
  {
    // `desktop/` — оболочка Electron: процесс Node, а не страница Next.
    // Главный процесс здесь намеренно на CommonJS: ESM-точка входа работает
    // только начиная с Electron 28 и добавляет способ сломаться ради
    // ничего. Поэтому `require()` остаётся, а правило, написанное для
    // TypeScript, для этой папки выключено. Остальные правила — в том числе
    // то, что выше, — на неё распространяются.
    files: ["desktop/**/*.js", "desktop/**/*.mjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
