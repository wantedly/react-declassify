// @ts-check

/** @type {import("eslint").Linter.Config} */
const config = {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:node/recommended",
    "prettier",
  ],
  plugins: ["@babel/development"],
  parser: "@typescript-eslint/parser",
  reportUnusedDisableDirectives: true,
  rules: {
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        varsIgnorePattern: "^_",
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
    "no-constant-condition": [
      "error",
      {
        checkLoops: false,
      },
    ],
    "node/no-unsupported-features/es-syntax": "off",
    // Specifying *.js for *.ts doesn't work now
    "node/no-missing-import": "off",
    // Disabling it until it skips type-only imports
    "node/no-unpublished-import": "off",
    // We target newer Node, so this is unnecessary
    "no-inner-declarations": "off",
  },
  overrides: [
    {
      files: ["src/**/*.ts"],
      extends: [
        "plugin:@typescript-eslint/recommended-requiring-type-checking",
      ],
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ["*.test.ts"],
      extends: ["plugin:jest/recommended"],
      rules: {
        "node/no-unpublished-import": "off",
      },
    },
  ],
  ignorePatterns: ["cjs/dist/**/*", "dist/**/*", "coverage/**/*"],
};
module.exports = config;
