import type { NodePath } from "@babel/core";
import type { ClassDeclaration, ClassMethod, Expression, ImportDeclaration, MemberExpression, TSType } from "@babel/types";
import { importName, memberName, memberRefName } from "./utils.js";

export type ComponentHead = {
  props: NodePath<TSType> | undefined;
};

export function analyzeHead(path: NodePath<ClassDeclaration>): ComponentHead | undefined {
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

export type RefInfo = {
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

export type ComponentBody = {
  render: RenderAnalysis;
};

export function analyzeBody(path: NodePath<ClassDeclaration>): ComponentBody {
  const data: Partial<ComponentBody> = {};
  for (const itemPath of path.get("body").get("body")) {
    if (itemPath.isClassMethod()) {
      const name = memberName(itemPath.node);
      if (name === "render") {
        data.render = analyzeRender(itemPath);
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
  if (!data.render) {
    throw new AnalysisError(`Missing render method`);
  }
  return {
    ...data,
    render: data.render,
  };
}

export type RenderAnalysis = {
  path: NodePath<ClassMethod>;
  thisRefs: ThisRef[];
};

function analyzeRender(path: NodePath<ClassMethod>): RenderAnalysis {
  const thisRefs: ThisRef[] = [];
  path.traverse({
    ThisExpression(path) {
      const parentPath = path.parentPath;
      if (!parentPath.isMemberExpression()) {
        throw new AnalysisError(`Stray this`);
      }
      const name = memberRefName(parentPath.node);
      if (name === "props") {
        thisRefs.push({
          kind: "props",
          path: parentPath,
        });
      } else {
        throw new AnalysisError(`Unrecognized class field reference: ${name ?? "<computed>"}`);
      }
    },
    FunctionDeclaration(path) {
      path.skip();
    },
    FunctionExpression(path) {
      path.skip();
    },
    ClassDeclaration(path) {
      path.skip();
    },
    ClassExpression(path) {
      path.skip();
    },
    ObjectMethod(path) {
      path.skip();
    },
  });
  return { path, thisRefs };
}

export type ThisRef = {
  kind: "props";
  path: NodePath<MemberExpression>;
};

export function needsProps(body: ComponentBody): boolean {
  return body.render.thisRefs.some((r) => r.kind === "props");
}

export class AnalysisError extends Error {
  static {
    this.prototype.name = "AnalysisError";
  }
}
