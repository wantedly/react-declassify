// @ts-check

/** @type {import("@babel/core").TransformOptions} */
const config = {
  extends: "./babel.config.js",
  presets: [
    ["@babel/env", { modules: "commonjs" }],
  ],
};
export default config;

