import type { NodePath, PluginObj, PluginPass } from "@babel/core";
import { ClassDeclaration, ClassMethod, Identifier, TSType } from "@babel/types";
import { isTS, memberName } from "./utils.js";

type Options = {};

export default function plugin(babel: typeof import("@babel/core")): PluginObj<PluginPass & { opts: Options }> {
  const { types: t } = babel;
  return {
    name: "react-declassify",
    visitor: {
      ClassDeclaration(path, state) {
        const ts = isTS(state);
        const head = analyzeHead(path);
        if (!head) {
          return;
        }
        const body = analyzeBody(path);
        path.replaceWith(t.variableDeclaration("const", [
          t.variableDeclarator(
            ts
            ? Object.assign<Identifier, Partial<Identifier>>(t.cloneNode(path.node.id), {
              typeAnnotation: t.tsTypeAnnotation(
                t.tsTypeReference(
                  t.tsQualifiedName(
                    t.identifier("React"),
                    t.identifier("FC"),
                  ),
                ),
              ),
            })
            : t.cloneNode(path.node.id),
            t.arrowFunctionExpression([],
              body.render
                ? body.render.node.body
                : t.blockStatement([])
            ),
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

type ComponentBody = {
  render?: NodePath<ClassMethod>;
};

function analyzeBody(path: NodePath<ClassDeclaration>): ComponentBody {
  const data: ComponentBody = {};
  for (const itemPath of path.get("body").get("body")) {
    if (itemPath.isClassMethod()) {
      const name = memberName(itemPath.node);
      if (name === "render") {
        data.render = itemPath;
      }
    }
  }
  return data;
}
