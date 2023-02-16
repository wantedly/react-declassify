import type { NodePath, PluginObj, PluginPass } from "@babel/core";
import type { ClassDeclaration, ClassMethod, Expression, Identifier, ImportDeclaration, TSType } from "@babel/types";
import { assignTypeAnnotation, importName, isTS, memberName, memberRefName } from "./utils.js";

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
        try {
          const body = analyzeBody(path);
          path.replaceWith(t.variableDeclaration("const", [
            t.variableDeclarator(
              ts
              ? assignTypeAnnotation(
                t.cloneNode(path.node.id),
                t.tsTypeAnnotation(
                  t.tsTypeReference(
                    t.tsQualifiedName(
                      t.identifier("React"),
                      t.identifier("FC"),
                    ),
                  ),
                ),
              )
              : t.cloneNode(path.node.id),
              t.arrowFunctionExpression([],
                body.render
                  ? body.render.node.body
                  : t.blockStatement([])
              ),
            )
          ]));
        } catch (e) {
          if (!(e instanceof AnalysisError)) {
            throw e;
          }
          t.addComment(path.node, "leading", ` react-declassify:disabled Cannot perform transformation: ${e.message} `);
          refreshComments(path.node);
        }
      },
    },
  };
}

/**
 * Refreshes recast's internal state to force generically printing comments.
 */
function refreshComments(node: any) {
  for (const comment of node.leadingComments ?? []) {
    comment.leading ??= true;
    comment.trailing ??= false;
  }
  for (const comment of node.trailingComments ?? []) {
    comment.leading ??= false;
    comment.trailing ??= true;
  }
  node.comments = [
    ...node.leadingComments ?? [],
    ...node.innerComments ?? [],
    ...node.trailingComments ?? [],
  ];
  node.original = undefined;
}

type ComponentHead = {
  props: NodePath<TSType> | undefined;
};

function analyzeHead(path: NodePath<ClassDeclaration>): ComponentHead | undefined {
  const superClass = path.get("superClass");
  if (!superClass.isExpression()) {
    return;
  }
  const superClassRef = analyzeRef(superClass);
  if (!superClassRef || !isReactRef(superClassRef)) {
    return;
  }
  if (superClassRef.name === "Component" || superClassRef.name === "PureComponent") {
    return {
      props: undefined
    };
  }
}

type RefInfo = {
  type: "import";
  source: string;
  name: string;
} | {
  type: "global";
  globalName: string;
  name: string;
};

function analyzeRef(path: NodePath<Expression>): RefInfo | undefined {
  if (path.isIdentifier()) {
    const binding = path.scope.getBinding(path.node.name);
    if (!binding) {
      return;
    }
    const decl = binding.path;
    if (decl.isImportSpecifier()) {
      return {
        type: "import",
        source: (decl.parentPath as NodePath<ImportDeclaration>).node.source.value,
        name: importName(decl.node.imported),
      };
    } else if (decl.isImportDefaultSpecifier()) {
      return {
        type: "import",
        source: (decl.parentPath as NodePath<ImportDeclaration>).node.source.value,
        name: "default",
      };
    }
  } else if (path.isMemberExpression()) {
    const ns = path.get("object");
    if (!ns.isIdentifier()) {
      return;
    }
    const name = memberRefName(path.node);
    if (name == null) {
      return;
    }

    const binding = path.scope.getBinding(ns.node.name);
    if (!binding) {
      return {
        type: "global",
        globalName: ns.node.name,
        name,
      };
    }
    const decl = binding.path;
    if (decl.isImportNamespaceSpecifier()) {
      return {
        type: "import",
        source: (decl.parentPath as NodePath<ImportDeclaration>).node.source.value,
        name,
      };
    } else if (decl.isImportDefaultSpecifier()) {
      return {
        type: "import",
        source: (decl.parentPath as NodePath<ImportDeclaration>).node.source.value,
        name,
      };
    }
  }
}

function isReactRef(r: RefInfo): boolean {
  return (r.type === "import" && r.source === "react") || (r.type === "global" && r.globalName === "React");
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
      } else {
        throw new AnalysisError(`Unrecognized class element: ${name ?? "<computed>"}`);
      }
    } else if (
      itemPath.isClassProperty()
      || itemPath.isClassPrivateMethod()
      || itemPath.isClassPrivateProperty()
      || itemPath.isTSDeclareMethod()
    ) {
      const name = memberName(itemPath.node);
      throw new AnalysisError(`Unrecognized class element: ${name ?? "<computed>"}`);
    } else {
      throw new AnalysisError("Unrecognized class element");
    }
  }
  return data;
}

class AnalysisError extends Error {
  static {
    this.prototype.name = "AnalysisError";
  }
}
