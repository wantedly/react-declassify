import { expect, test } from "@jest/globals";
import { transform } from "@codemod/core";

type _T = 42;

test("example", () => {
  expect(42).toBe(42);
});

test("recast transform", () => {
  const result = transform("a ?? b", {
    configFile: false,
    babelrc: false,
    plugins: [],
  })

  expect(result.code).toBe("a ?? b");
});
