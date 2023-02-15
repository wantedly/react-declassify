import { describe, it, expect } from "@jest/globals";
import { transform as transformCore } from "@codemod/core";
import plugin from "./index.js";

function transform(code: string, options: {
  ts?: boolean | undefined
} = {}) {
  const { ts } = options;
  const result = transformCore(code, {
    configFile: false,
    babelrc: false,
    filename: ts ? "file.tsx" : "file.jsx",
    parserOpts: {
      plugins: ["jsx", "typescript"],
    },
    plugins: [plugin],
  });
  return result.code;
}

describe("react-declassify", () => {
  it("transforms simple Component class", () => {
    expect(transform(`class C extends React.Component {
  render() {
    return <div>Hello, world!</div>;
  }
}`)).toBe(`const C = () => {
  return <div>Hello, world!</div>;
};`);
  });

  it("generates React.FC", () => {
    expect(transform(`class C extends React.Component {
  render() {
    return <div>Hello, world!</div>;
  }
}`, { ts: true })).toBe(`const C: React.FC = () => {
  return <div>Hello, world!</div>;
};`);
  });

  it("transforms empty Component class", () => {
    expect(transform("class C extends React.Component {}")).toBe("const C = () => {};");
  });

  describe("Component detection", () => {
    it("transforms Component subclass (named import case)", () => {
      expect(transform(`import { Component } from "react";
class C extends Component {}`)).toBe(`import { Component } from "react";
const C = () => {};`);
    });

    it("transforms PureComponent subclass", () => {
      expect(transform(`import React from "react";
class C extends React.PureComponent {}`)).toBe(`import React from "react";
const C = () => {};`);
    });

    it("transforms Component subclass (renamed import case)", () => {
      expect(transform(`import { Component as CBase } from "react";
class C extends CBase {}`)).toBe(`import { Component as CBase } from "react";
const C = () => {};`);
    });

    it("transforms React.Component subclass (global case)", () => {
      expect(transform("class C extends React.Component {}")).toBe("const C = () => {};");
    });

    it("transforms React.Component subclass (default import case)", () => {
      expect(transform(`import React from "react";
class C extends React.Component {}`)).toBe(`import React from "react";
const C = () => {};`);
    });

    it("transforms React.Component subclass (namespace import case)", () => {
      expect(transform(`import * as React from "react";
class C extends React.Component {}`)).toBe(`import * as React from "react";
const C = () => {};`);
    });

    it("transforms React.Component subclass (renamed default import case)", () => {
      expect(transform(`import MyReact from "react";
class C extends MyReact.Component {}`)).toBe(`import MyReact from "react";
const C = () => {};`);
    });

    it("ignores plain classes", () => {
      expect(transform("class C {}")).toBe("class C {}");
    });

    it("ignores complex inheritance", () => {
      expect(transform("class C extends mixin() {}")).toBe("class C extends mixin() {}");
    });

    it("ignores non-Component subclass (named import case)", () => {
      expect(transform(`import { Componen } from "react";
class C extends Componen {}`)).toBe(`import { Componen } from "react";
class C extends Componen {}`);
    });

    it("ignores non-Component subclass (renamed import case)", () => {
      expect(transform(`import { Componen as Component } from "react";
class C extends Component {}`)).toBe(`import { Componen as Component } from "react";
class C extends Component {}`);
    });

    it("ignores non-Component subclass (global case)", () => {
      expect(transform("class C extends React.Componen {}")).toBe("class C extends React.Componen {}");
    });

    it("ignores non-Component subclass (default import case)", () => {
      expect(transform(`import React from "react";
class C extends React.Componen {}`)).toBe(`import React from "react";
class C extends React.Componen {}`);
    });

    it("ignores non-Component subclass (namespace import case)", () => {
      expect(transform(`import * as React from "react";
class C extends React.Componen {}`)).toBe(`import * as React from "react";
class C extends React.Componen {}`);
    });

    it("ignores non-React subclass (non-react import case)", () => {
      expect(transform(`import React from "reeeeact";
class C extends React.Component {}`)).toBe(`import React from "reeeeact";
class C extends React.Component {}`);
    });
  });
});
