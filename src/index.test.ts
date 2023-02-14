import { expect, test } from "@jest/globals";
import { transform } from "@codemod/core";
import foo from "./index.js";

type _T = 42;

test("example", () => {
  expect(foo).toBe(42);
});

test("recast transform", () => {
  const result = transform("a ?? b", {
    configFile: false,
    babelrc: false,
    plugins: [],
  })

  expect(result.code).toBe("a ?? b");
});
