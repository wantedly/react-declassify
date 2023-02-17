import { describe, it, expect } from "@jest/globals";
import { transform as transformCore } from "@codemod/core";
import { dedent } from "@qnighy/dedent";
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
    const input = dedent`
      class C extends React.Component {
        render() {
          return <div>Hello, world!</div>;
        }
      }
    `;
    const output = dedent`
      const C = () => {
        return <div>Hello, world!</div>;
      };
    `;
    expect(transform(input)).toBe(output);
  });

  it("generates React.FC", () => {
    const input = dedent`
      class C extends React.Component {
        render() {
          return <div>Hello, world!</div>;
        }
      }
    `;
    const output = dedent`
      const C: React.FC = () => {
        return <div>Hello, world!</div>;
      };
    `;
    expect(transform(input, { ts: true })).toBe(output);
  });

  it("doesn't transform empty Component class", () => {
    const input = dedent`
      class C extends React.Component {}
    `;
    const output = dedent`
      /* react-declassify:disabled Cannot perform transformation: Missing render method */
      class C extends React.Component {}
    `;
    expect(transform(input)).toBe(output);
  });

  it("adds error message when analysis failed", () => {
    const input = dedent`
      class C extends React.Component {
        rende() {}
      }
    `;
    const output = dedent`
      /* react-declassify:disabled Cannot perform transformation: Unrecognized class element: rende */
      class C extends React.Component {
        rende() {}
      }
    `;
    expect(transform(input)).toBe(output);
  });

  describe("Component detection", () => {
    it("transforms Component subclass (named import case)", () => {
      const input = dedent`
        import { Component } from "react";
        class C extends Component {
          render() {}
        }
      `;
      const output = dedent`
        import { Component } from "react";
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms PureComponent subclass", () => {
      const input = dedent`
        import React from "react";
        class C extends React.PureComponent {
          render() {}
        }
      `;
      const output = dedent`
        import React from "react";
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms Component subclass (renamed import case)", () => {
      const input = dedent`
        import { Component as CBase } from "react";
        class C extends CBase {
          render() {}
        }
      `;
      const output = dedent`
        import { Component as CBase } from "react";
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms React.Component subclass (global case)", () => {
      const input = dedent`
        class C extends React.Component {
          render() {}
        }
      `;
      const output = dedent`
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms React.Component subclass (default import case)", () => {
      const input = dedent`
        import React from "react";
        class C extends React.Component {
          render() {}
        }
      `;
      const output = dedent`
        import React from "react";
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms React.Component subclass (namespace import case)", () => {
      const input = dedent`
        import * as React from "react";
        class C extends React.Component {
          render() {}
        }
      `;
      const output = dedent`
        import * as React from "react";
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms React.Component subclass (renamed default import case)", () => {
      const input = dedent`
        import MyReact from "react";
        class C extends MyReact.Component {
          render() {}
        }
      `;
      const output = dedent`
        import MyReact from "react";
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("ignores plain classes", () => {
      const input = dedent`
        class C {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores complex inheritance", () => {
      const input = dedent`
        class C extends mixin() {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores non-Component subclass (named import case)", () => {
      const input = dedent`
        import { Componen } from "react";
        class C extends Componen {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores non-Component subclass (renamed import case)", () => {
      const input = dedent`
        import { Componen as Component } from "react";
        class C extends Component {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores non-Component subclass (global case)", () => {
      const input = dedent`
        class C extends React.Componen {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores non-Component subclass (default import case)", () => {
      const input = dedent`
        import React from "react";
        class C extends React.Componen {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores non-Component subclass (namespace import case)", () => {
      const input = dedent`
        import * as React from "react";
        class C extends React.Componen {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores non-React subclass (non-react import case)", () => {
      const input = dedent`
        import React from "reeeeact";
        class C extends React.Component {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });
  });

  it("transforms props", () => {
    const input = dedent`
      class C extends React.Component {
        render() {
          return <div>Hello, {this.props.name}!</div>;
        }
      }
    `;
    const output = dedent`
      const C = props => {
        return <div>Hello, {props.name}!</div>;
      };
    `;
    expect(transform(input)).toBe(output);
  });
});
