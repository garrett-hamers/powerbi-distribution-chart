const tseslint = require("@typescript-eslint/eslint-plugin");
const parser = require("@typescript-eslint/parser");
const powerbiVisuals = require("eslint-plugin-powerbi-visuals");

module.exports = [
  {
    ignores: ["node_modules/**", "coverage/**", "dist/**", ".tmp/**", "*.pbiviz"],
  },
  powerbiVisuals.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 2017,
        sourceType: "module"
      }
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-undef": "off"
    }
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "powerbi-visuals/non-literal-fs-path": "off"
    }
  },
  {
    files: ["scripts/**/*.js"],
    rules: {
      "powerbi-visuals/non-literal-fs-path": "off"
    }
  }
];
