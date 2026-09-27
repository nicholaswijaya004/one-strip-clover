/**
 * ESLint — dijalankan di CI (job "lint") dan lewat `npm run lint`.
 *
 * Fokusnya bug & keamanan, bukan gaya penulisan: variabel tak terdefinisi,
 * kode yang tidak pernah jalan, eval/new Function, perbandingan longgar.
 */
const js = require("@eslint/js");
const globals = require("globals");

const aturanKeamanan = {
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-script-url": "error",
  "no-proto": "error",
  "no-extend-native": "error",
  eqeqeq: ["error", "smart"],
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
  "no-empty": ["error", { allowEmptyCatch: true }],
};

module.exports = [
  {
    ignores: ["node_modules/**", "data/**", "frontend-react/**", "coverage/**"],
  },
  js.configs.recommended,
  {
    // Server, pustaka, skrip terminal
    files: ["server.js", "lib/**/*.js", "scripts/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "commonjs", globals: globals.node },
    rules: aturanKeamanan,
  },
  {
    // Skrip halaman (dimuat browser apa adanya, tanpa bundler)
    files: ["public/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, OSC: "readonly", StripRenderer: "readonly" },
    },
    rules: aturanKeamanan,
  },
  {
    // Modul bersama browser + Node (pola UMD)
    files: ["public/shared/**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: aturanKeamanan,
  },
  {
    // Tes & simulator boleh memakai new Function untuk menjalankan skrip halaman
    files: ["test/**/*.js", "scripts/simulasi-browser.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "commonjs", globals: globals.node },
    rules: { ...aturanKeamanan, "no-new-func": "off" },
  },
];
