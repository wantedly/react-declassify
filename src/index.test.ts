import { describe, it, expect, test } from "@jest/globals";
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
    const input = dedent`\
      class C extends React.Component {
        render() {
          return <div>Hello, world!</div>;
        }
      }
    `;
    const output = dedent`\
      const C = () => {
        return <div>Hello, world!</div>;
      };
    `;
    expect(transform(input)).toBe(output);
  });

  describe("TypeScript support", () => {
    it("generates React.FC", () => {
      const input = dedent`\
        class C extends React.Component {
          render() {
            return <div>Hello, world!</div>;
          }
        }
      `;
      const output = dedent`\
        const C: React.FC = () => {
          return <div>Hello, world!</div>;
        };
      `;
      expect(transform(input, { ts: true })).toBe(output);
    });

    it("generates FC", () => {
      const input = dedent`\
        import { Component } from "react";
        class C extends Component {
          render() {
            return <div>Hello, world!</div>;
          }
        }
      `;
      const output = dedent`\
        import { Component, FC } from "react";

        const C: FC = () => {
          return <div>Hello, world!</div>;
        };
      `;
      expect(transform(input, { ts: true })).toBe(output);
    });

    it("transforms first type argument", () => {
      const input = dedent`\
        type Props = {
          text: string;
        };
        class C extends React.Component<Props> {
          render() {
            return <div>Hello, {this.props.text}!</div>;
          }
        }
      `;
      const output = dedent`\
        type Props = {
          text: string;
        };

        const C: React.FC<Props> = props => {
          return <div>Hello, {props.text}!</div>;
        };
      `;
      expect(transform(input, { ts: true })).toBe(output);
    });
  });

  it("doesn't transform empty Component class", () => {
    const input = dedent`\
      class C extends React.Component {}
    `;
    const output = dedent`\
      /* react-declassify:disabled Cannot perform transformation: Missing render method */
      class C extends React.Component {}
    `;
    expect(transform(input)).toBe(output);
  });

  it("adds error message when analysis failed", () => {
    const input = dedent`\
      class C extends React.Component {
        rende() {}
      }
    `;
    const output = dedent`\
      /* react-declassify:disabled Cannot perform transformation: Missing render method */
      class C extends React.Component {
        rende() {}
      }
    `;
    expect(transform(input)).toBe(output);
  });

  describe("Component detection", () => {
    it("transforms Component subclass (named import case)", () => {
      const input = dedent`\
        import { Component } from "react";
        class C extends Component {
          render() {}
        }
      `;
      const output = dedent`\
        import { Component } from "react";
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms PureComponent subclass", () => {
      const input = dedent`\
        import React from "react";
        class C extends React.PureComponent {
          render() {}
        }
      `;
      const output = dedent`\
        import React from "react";
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms Component subclass (renamed import case)", () => {
      const input = dedent`\
        import { Component as CBase } from "react";
        class C extends CBase {
          render() {}
        }
      `;
      const output = dedent`\
        import { Component as CBase } from "react";
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms React.Component subclass (global case)", () => {
      const input = dedent`\
        class C extends React.Component {
          render() {}
        }
      `;
      const output = dedent`\
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms React.Component subclass (default import case)", () => {
      const input = dedent`\
        import React from "react";
        class C extends React.Component {
          render() {}
        }
      `;
      const output = dedent`\
        import React from "react";
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms React.Component subclass (namespace import case)", () => {
      const input = dedent`\
        import * as React from "react";
        class C extends React.Component {
          render() {}
        }
      `;
      const output = dedent`\
        import * as React from "react";
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms React.Component subclass (renamed default import case)", () => {
      const input = dedent`\
        import MyReact from "react";
        class C extends MyReact.Component {
          render() {}
        }
      `;
      const output = dedent`\
        import MyReact from "react";
        const C = () => {};
      `;
      expect(transform(input)).toBe(output);
    });

    it("ignores plain classes", () => {
      const input = dedent`\
        class C {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores complex inheritance", () => {
      const input = dedent`\
        class C extends mixin() {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores non-Component subclass (named import case)", () => {
      const input = dedent`\
        import { Componen } from "react";
        class C extends Componen {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores non-Component subclass (renamed import case)", () => {
      const input = dedent`\
        import { Componen as Component } from "react";
        class C extends Component {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores non-Component subclass (global case)", () => {
      const input = dedent`\
        class C extends React.Componen {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores non-Component subclass (default import case)", () => {
      const input = dedent`\
        import React from "react";
        class C extends React.Componen {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores non-Component subclass (namespace import case)", () => {
      const input = dedent`\
        import * as React from "react";
        class C extends React.Componen {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });

    it("ignores non-React subclass (non-react import case)", () => {
      const input = dedent`\
        import React from "reeeeact";
        class C extends React.Component {
          render() {}
        }
      `;
      expect(transform(input)).toBe(input);
    });
  });

  describe("Class forms", () => {
    it("transforms a simple class declaration", () => {
      const input = dedent`\
        class C extends React.Component {
          render() {
            return <div>Hello, world!</div>;
          }
        }
      `;
      const output = dedent`\
        const C = () => {
          return <div>Hello, world!</div>;
        };
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms a class declaration within export default (named case)", () => {
      const input = dedent`\
        export default class C extends React.Component {
          render() {
            return <div>Hello, world!</div>;
          }
        }
      `;
      const output = dedent`\
        const C = () => {
          return <div>Hello, world!</div>;
        };

        export default C;
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms a class declaration within export default (anonymous case)", () => {
      const input = dedent`\
        export default class extends React.Component {
          render() {
            return <div>Hello, world!</div>;
          }
        }
      `;
      const output = dedent`\
        export default () => {
          return <div>Hello, world!</div>;
        };
      `;
      expect(transform(input)).toBe(output);
    });
  });

  describe("Render function transformation", () => {
    it("Renames local variables to avoid capturing", () => {
      const input = dedent`\
        class C extends React.Component {
          render() {
            const x = 42;
            this.foo(100);
            return x;
          }

          foo() {
            return x + 42;
          }
        }
      `;
      const output = dedent`\
        const C = () => {
          function foo() {
            return x + 42;
          }

          const x0 = 42;
          foo(100);
          return x0;
        };
      `;
      expect(transform(input)).toBe(output);
    });
  });

  describe("Method transformation", () => {
    it("transforms methods as functions", () => {
      const input = dedent`\
        class C extends React.Component {
          render() {
            this.foo(100);
            return null;
          }

          foo(x) {
            return x + 42;
          }
        }
      `;
      const output = dedent`\
        const C = () => {
          function foo(x) {
            return x + 42;
          }

          foo(100);
          return null;
        };
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms functional fields as functions", () => {
      const input = dedent`\
        class C extends React.Component {
          render() {
            this.foo(100);
            return null;
          }

          foo = (x) => {
            return x + 42;
          }
        }
      `;
      const output = dedent`\
        const C = () => {
          function foo(x) {
            return x + 42;
          }

          foo(100);
          return null;
        };
      `;
      expect(transform(input)).toBe(output);
    });

    it("transforms this.props in methods", () => {
      const input = dedent`\
        class C extends React.Component {
          render() {
            this.foo();
            return null;
          }

          foo() {
            return this.props.foo + 42;
          }
        }
      `;
      const output = dedent`\
        const C = props => {
          function foo() {
            return props.foo + 42;
          }

          foo();
          return null;
        };
      `;
      expect(transform(input)).toBe(output);
    });

    it("hoists this.props expansion", () => {
      const input = dedent`\
        class C extends React.Component {
          render() {
            const { bar, baz } = this.props;
            return this.meth() + bar + baz;
          }

          meth() {
            const { foo, bar } = this.props;
            return foo + bar;
          }
        }
      `;
      const output = dedent`\
        const C = props => {
          const {
            bar,
            baz,
            foo
          } = props;

          function meth() {
            return foo + bar;
          }

          return meth() + bar + baz;
        };
      `;
      expect(transform(input)).toBe(output);
    });

    it("Transforms defaultProps", () => {
      const input = dedent`\
        class C extends React.Component {
          static defaultProps = {
            foo: 42,
            quux: 0,
          };
          render() {
            const { foo, bar } = this.props;
            return foo + bar + this.props.baz + this.props.quux;
          }
        }
      `;
      const output = dedent`\
        const C = props => {
          const {
            foo = 42,
            bar,
            baz,
            quux = 0
          } = props;
          return foo + bar + baz + quux;
        };
      `;
      expect(transform(input)).toBe(output);
    });
  });

  describe("State transformation", () => {
    it("transforms simple states", () => {
      const input = dedent`\
        class C extends React.Component {
          state = {
            foo: 1,
            bar: 2,
          };
          render() {
            return <button onClick={() => this.setState({ bar: 3 })}>{this.state.foo}</button>;
          }
        }
      `;
      const output = dedent`\
        const C = () => {
          const [foo, setFoo] = React.useState(1);
          const [bar, setBar] = React.useState(2);
          return <button onClick={() => setBar(3)}>{foo}</button>;
        };
      `;
      expect(transform(input)).toBe(output);
    });
  });

  it("transforms props", () => {
    const input = dedent`\
      class C extends React.Component {
        render() {
          return <div>Hello, {this.props.name}!</div>;
        }
      }
    `;
    const output = dedent`\
      const C = props => {
        return <div>Hello, {props.name}!</div>;
      };
    `;
    expect(transform(input)).toBe(output);
  });

  describe("constructor support", () => {
    it("transforms state in constructor", () => {
      const input = dedent`\
        class C extends React.Component {
          constructor(props) {
            super(props);
            this.state = {
              foo: 1,
              bar: 2,
            };
          }
          render() {
            return <button onClick={() => this.setState({ bar: 3 })}>{this.state.foo}</button>;
          }
        }
      `;
      const output = dedent`\
        const C = () => {
          const [foo, setFoo] = React.useState(1);
          const [bar, setBar] = React.useState(2);
          return <button onClick={() => setBar(3)}>{foo}</button>;
        };
      `;
      expect(transform(input)).toBe(output);
    });
  });

  test("readme example 1", () => {
    const input = dedent`\
      import React from "react";

      export class C extends React.Component {
        render() {
          const { text, color } = this.props;
          return <button style={{ color }} onClick={() => this.onClick()}>{text}</button>;
        }

        onClick() {
          const { text, handleClick } = this.props;
          alert(\`\${text} was clicked!\`);
          handleClick();
        }
      }
    `;
    const output = dedent`\
      import React from "react";

      export const C = props => {
        const {
          text,
          color,
          handleClick
        } = props;

        function onClick() {
          alert(\`\${text} was clicked!\`);
          handleClick();
        }

        return <button style={{ color }} onClick={() => onClick()}>{text}</button>;
      };
    `;
    expect(transform(input)).toBe(output);
  });
});
