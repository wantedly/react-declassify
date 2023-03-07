import type { NodePath } from "@babel/core";
import type { ClassDeclaration, Expression, ImportDeclaration, ImportDefaultSpecifier, ImportNamespaceSpecifier, ImportSpecifier, TSType } from "@babel/types";
import { importName, memberRefName } from "../utils.js";

export type ComponentHead = {
  superClassRef: RefInfo;
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
    let props: NodePath<TSType> | undefined;
    const superTypeParameters = path.get("superTypeParameters");
    if (superTypeParameters.isTSTypeParameterInstantiation()) {
      const params = superTypeParameters.get("params");
      if (params.length > 0) {
        props = params[0];
      }
    }
    return { superClassRef, props };
  }
}

export type RefInfo = {
  type: "import";
  kind: "named";
  source: string;
  specPath: NodePath<ImportSpecifier | ImportDefaultSpecifier>;
  name: string;
} | {
  type: "import";
  kind: "ns";
  source: string;
  specPath: NodePath<ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier>;
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
        kind: "named",
        source: (decl.parentPath as NodePath<ImportDeclaration>).node.source.value,
        specPath: decl,
        name: importName(decl.node.imported),
      };
    } else if (decl.isImportDefaultSpecifier()) {
      return {
        type: "import",
        kind: "named",
        source: (decl.parentPath as NodePath<ImportDeclaration>).node.source.value,
        specPath: decl,
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
        kind: "ns",
        source: (decl.parentPath as NodePath<ImportDeclaration>).node.source.value,
        specPath: decl,
        name,
      };
    } else if (
      decl.isImportDefaultSpecifier()
      || (decl.isImportSpecifier() && importName(decl.node.imported) === "default")
    ) {
      return {
        type: "import",
        kind: "ns",
        source: (decl.parentPath as NodePath<ImportDeclaration>).node.source.value,
        specPath: decl,
        name,
      };
    }
  }
}

function isReactRef(r: RefInfo): boolean {
  return (r.type === "import" && r.source === "react") || (r.type === "global" && r.globalName === "React");
}
