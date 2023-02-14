import { expect, test } from "@jest/globals";
import { transform } from "@codemod/core";
import plugin from "./index.js";

test("recast transform", () => {
  const result = transform("a ?? b", {
    configFile: false,
    babelrc: false,
    plugins: [plugin],
  })

  expect(result.code).toBe("a ?? b");
});
