// @ts-check

/** @type {import("@babel/core").TransformOptions} */
const config = {
  targets: "node 18",
  presets: [
    ["@babel/env", { modules: false }],
    ["@babel/typescript", { allowDeclareFields: true }],
  ],
};
export default config;
