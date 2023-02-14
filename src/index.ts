import type { NodePath, PluginObj } from "@babel/core";
import type { ClassDeclaration, TSType } from "@babel/types";
export default function plugin(babel: typeof import("@babel/core")): PluginObj {
  const { types: t } = babel;
  return {
    name: "react-unclass",
    visitor: {
      ClassDeclaration(path) {
        const head = analyzeHead(path);
        if (!head) {
          return;
        }
        path.replaceWith(t.variableDeclaration("const", [
          t.variableDeclarator(
            t.cloneNode(path.node.id),
            t.arrowFunctionExpression([], t.blockStatement([])),
          )
        ]));
      },
    },
  };
}

type ComponentHead = {
  props: NodePath<TSType> | undefined;
};

function analyzeHead(path: NodePath<ClassDeclaration>): ComponentHead | undefined {
  const superClass = path.get("superClass");
  if (!superClass) return;
  if (superClass.isIdentifier() && superClass.node.name === "Component") {
    return { props: undefined };
  }
}
