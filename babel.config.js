// @ts-check

/** @type {import("@babel/core").TransformOptions} */
const config = {
  presets: [
    ["@babel/typescript", { allowDeclareFields: true }],
  ],
};
export default config;
