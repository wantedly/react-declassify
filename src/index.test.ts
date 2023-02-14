import { describe, it, expect } from "@jest/globals";
import { transform as transformCore } from "@codemod/core";
import plugin from "./index.js";

function transform(code: string) {
  const result = transformCore(code, {
    configFile: false,
    babelrc: false,
    plugins: [plugin],
  });
  return result.code;
}

describe("react-unclass", () => {
  it("transforms Component class", () => {
    expect(transform("class C extends Component {}")).toBe("const foo = null;");
  });

  it("ignores plain classes", () => {
    expect(transform("class C {}")).toBe("class C {}");
  });
});
