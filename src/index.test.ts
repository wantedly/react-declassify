import { describe, it, expect } from "@jest/globals";
import { transform as transformCore } from "@codemod/core";
import plugin from "./index.js";

function transform(code: string) {
  const result = transformCore(code, {
    configFile: false,
    babelrc: false,
    parserOpts: {
      plugins: ["jsx", "typescript"],
    },
    plugins: [plugin],
  });
  return result.code;
}

describe("react-declassify", () => {
  it("transforms simple Component class", () => {
    expect(transform(`class C extends Component {
  render() {
    return <div>Hello, world!</div>;
  }
}`)).toBe(`const C = () => {
  return <div>Hello, world!</div>;
};`);
  });

  it("transforms empty Component class", () => {
    expect(transform("class C extends Component {}")).toBe("const C = () => {};");
  });

  it("ignores plain classes", () => {
    expect(transform("class C {}")).toBe("class C {}");
  });
});
