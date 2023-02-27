import type { NodePath } from "@babel/core";
import type { Scope } from "@babel/traverse";
import type { ClassDeclaration, ClassMethod, Expression, Identifier, ImportDeclaration, JSXIdentifier, MemberExpression, ThisExpression, TSType } from "@babel/types";
import { importName, memberName, memberRefName } from "./utils.js";

const SPECIAL_MEMBER_NAMES = new Set<string>([
  // Special variables
  "context",
  "props",
  "refs",
  "state",
  // Lifecycle
  "constructor",
  "render",
  "componentDidCatch",
  "componentDidMount",
  "componentDidUpdate",
  "componentWillMount",
  "UNSAFE_componentWillMount",
  "componentWillReceiveProps",
  "UNSAFE_componentWillReceiveProps",
  "componentWillUpdate",
  "UNSAFE_componentWillUpdate",
  "componentWillUnmount",
  // Lifecycle predicates
  "shouldComponentUpdate",
  "getSnapshotBeforeUpdate",
  "getChildContext",
  // APIs (including deprecated)
  "isReactComponent",
  "isMounted",
  "forceUpdate",
  "setState",
  "replaceState",
]);
const SPECIAL_STATIC_NAMES = new Set<string>([
  "childContextTypes",
  "contextTypes",
  "contextType",
  "defaultProps",
  "getDerivedStateFromError",
  "getDerivedStateFromProps",
]);

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
  members: Map<string, MethodAnalysis>;
  thisRefs: ThisRef[];
  propVars: PropVar[];
  propVarNames: Map<string, string>;
  propBinders: PropBinder[];
};

export function analyzeBody(path: NodePath<ClassDeclaration>, babel: typeof import("@babel/core")): ComponentBody {
  const locals = analyzeOuterCapturings(path);
  const thisRefs = analyzeThisRefs(path);
  const { propVars, propVarNames, propBinders } = analyzeProps(thisRefs, babel, locals);
  let render: RenderAnalysis | undefined = undefined;
  const members = new Map<string, MethodAnalysis>();
  for (const itemPath of path.get("body").get("body")) {
    if (itemPath.isClassMethod()) {
      const name = memberName(itemPath.node);
      if (name === "render") {
        render = analyzeRender(itemPath, babel, locals, propVars);
      } else if (name != null && !SPECIAL_MEMBER_NAMES.has(name)) {
        if (members.has(name)) {
          throw new AnalysisError(`Duplicate member: ${name}`);
        }
        members.set(name, analyzeMethod(itemPath));
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
  if (!render) {
    throw new AnalysisError(`Missing render method`);
  }
  return {
    render,
    members,
    thisRefs,
    propVars,
    propVarNames,
    propBinders,
  };
}

export type RenderAnalysis = {
  path: NodePath<ClassMethod>;
  renames: LocalRename[];
};

export type LocalRename = {
  scope: Scope,
  oldName: string;
  newName: string;
};

function analyzeRender(
  path: NodePath<ClassMethod>,
  babel: typeof import("@babel/core"),
  locals: Set<string>,
  propVars: PropVar[],
): RenderAnalysis {
  const renames: LocalRename[] = [];
  for (const [name, binding] of Object.entries(path.scope.bindings)) {
    if (
      propVars.some((pv) => pv.scope === binding.scope && pv.oldName ===name)
    ) {
      // Already handled as a propVar
      continue;
    }
    const newName = newLocal(name, babel, locals);
    renames.push({
      scope: binding.scope,
      oldName: name,
      newName,
    });
  }
  return { path, renames };
}

export type MethodAnalysis = {
  path: NodePath<ClassMethod>;
};

function analyzeMethod(path: NodePath<ClassMethod>): MethodAnalysis {
  return { path };
}

export type PropVar = {
  scope: Scope;
  propName: string;
  oldName: string;
  newName: string;
};

export type PropBinder = {
  path: NodePath;
};

/**
 * Detects assignments that expand `this.props` to variables, like:
 * 
 * ```js
 * const { foo, bar } = this.props;
 * ```
 * 
 * or:
 * 
 * ```js
 * const foo = this.props.foo;
 * const bar = this.props.bar;
 * ```
 */
function analyzeProps(
  thisRefs: ThisRef[],
  babel: typeof import("@babel/core"),
  locals: Set<string>,
): {
  propVars: PropVar[];
  propVarNames: Map<string, string>;
  propBinders: PropBinder[];
} {
  const propVars: PropVar[] = [];
  const propVarNames = new Map<string, string>();
  const propBinders: PropBinder[] = [];

  function getNewName(propName: string): string {
    const reusable = propVarNames.get(propName);
    if (reusable != null) return reusable;

    const newName = newLocal(propName, babel, locals);
    propVarNames.set(propName, newName);
    return newName;
  }

  for (const thisRef of thisRefs) {
    if (thisRef.kind !== "props") {
      continue;
    }
    const memPath = thisRef.path;
    if (
      memPath.parentPath.isMemberExpression()
      && memPath.parentPath.node.object === memPath.node
      && memPath.parentPath.parentPath.isVariableDeclarator()
      && memPath.parentPath.parentPath.node.init === memPath.parentPath.node
    ) {
      const propPath = memPath.parentPath;
      const declaratorPath = memPath.parentPath.parentPath;
      const declarationPath = memPath.parentPath.parentPath.parentPath;
      if (!declarationPath.isVariableDeclaration() || declarationPath.node.kind !== "const") {
        continue;
      }
      const lval = declaratorPath.get("id");
      if (!lval.isIdentifier()) {
        continue;
      }
      const propName = memberRefName(propPath.node);
      if (propName == null) {
        continue;
      }
      
      // const foo = this.props.foo;
      propVars.push({
        scope: memPath.scope,
        propName,
        oldName: lval.node.name,
        newName: getNewName(propName),
      });
      if (declarationPath.node.declarations.length === 1) {
        propBinders.push({
          path: declarationPath,
        });
      } else {
        propBinders.push({
          path: declaratorPath,
        });
      }
    } else if (
      memPath.parentPath.isVariableDeclarator()
      && memPath.parentPath.node.init === memPath.node
    ) {
      const declaratorPath = memPath.parentPath;
      const declarationPath = memPath.parentPath.parentPath;
      if (!declarationPath.isVariableDeclaration() || declarationPath.node.kind !== "const") {
        continue;
      }
      const lval = declaratorPath.get("id");
      if (!lval.isObjectPattern()) {
        continue;
      }

      // const { foo } = this.props;
      const lvpropPaths: NodePath[] = [];
      let replaceAll = true;
      for (const lvprop of lval.get("properties")) {
        if (!lvprop.isObjectProperty()) {
          replaceAll = false;
          break;
        }
        const propName = memberName(lvprop.node);
        if (propName == null) {
          replaceAll = false;
          break;
        }
        if (lvprop.node.value.type === "Identifier") {
          propVars.push({
            scope: memPath.scope,
            propName,
            oldName: lvprop.node.value.name,
            newName: getNewName(propName),
          });
          lvpropPaths.push(lvprop);
        } else {
          replaceAll = false;
        }
      }
      if (replaceAll && declarationPath.node.declarations.length === 1) {
        propBinders.push({ path: declarationPath });
      } else if (replaceAll) {
        propBinders.push({ path: declaratorPath });
      } else {
        for (const lvprop of lvpropPaths) {
          propBinders.push({ path: lvprop });
        }
      }
    }
  }
  return { propVars, propVarNames, propBinders };
}

function analyzeThisRefs(path: NodePath<ClassDeclaration>): ThisRef[] {
  const thisRefs: ThisRef[] = [];
  for (const mem of path.get("body").get("body")) {
    if (mem.isClassMethod()) {
      if (mem.node.static) {
        // TODO
      } else {
        for (const param of mem.get("params")) {
          analyzeThisRefsIn(thisRefs, param);
        }
        analyzeThisRefsIn(thisRefs, mem.get("body"));
      }
    } else if (mem.isClassProperty()) {
      if (mem.node.static) {
        // TODO
      } else {
        const value = mem.get("value");
        if (value.isExpression()) {
          analyzeThisRefsIn(thisRefs, value);
        }
      }
    }
  }
  return thisRefs;
}

function analyzeThisRefsIn(thisRefs: ThisRef[], path: NodePath) {
  traverseThis(path, (path) => {
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
    } else if (name != null && !SPECIAL_MEMBER_NAMES.has(name)) {
      thisRefs.push({
        kind: "userDefined",
        path: parentPath,
        name,
      });
    } else {
      throw new AnalysisError(`Unrecognized class field reference: ${name ?? "<computed>"}`);
    }
  });
}

function traverseThis(path: NodePath, visit: (path: NodePath<ThisExpression>) => void) {
  path.traverse({
    ThisExpression: visit,
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
}

export type ThisRef = {
  kind: "props";
  path: NodePath<MemberExpression>;
} | {
  kind: "userDefined";
  path: NodePath<MemberExpression>;
  name: string;
};

function analyzeOuterCapturings(classPath: NodePath<ClassDeclaration>): Set<string> {
  const capturings = new Set<string>();
  function visitIdent(path: NodePath<Identifier | JSXIdentifier>) {
    path.getOuterBindingIdentifiers
    const binding = path.scope.getBinding(path.node.name);
    if (!binding || binding.path.isAncestor(classPath)) {
      capturings.add(path.node.name);
    }
  }
  classPath.get("body").traverse({
    Identifier(path) {
      if (path.isReferencedIdentifier()) {
        visitIdent(path);
      }
    },
    JSXIdentifier(path) {
      if (path.isReferencedIdentifier()) {
        visitIdent(path);
      }
    }
  });
  return capturings;
}

function newLocal(baseName: string, babel: typeof import("@babel/core"), locals: Set<string>): string {
  let name = baseName.replace(/[^\p{ID_Continue}$\u200C\u200D]/gu, "");
  if (!/^[\p{ID_Start}_$]/u.test(name) || !babel.types.isValidIdentifier(name)) {
    name = `_${name}`;
  }
  if (locals.has(name)) {
    name = name.replace(/\d+$/, "");
    for (let i = 0;; i++) {
      if (i >= 1000000) {
        throw new Error("Unexpected infinite loop");
      }
      if (!locals.has(`${name}${i}`)) {
        name = `${name}${i}`;
        break;
      }
    }
  }
  locals.add(name);
  return name;
}

export function needsProps(body: ComponentBody): boolean {
  return body.thisRefs.some((r) => r.kind === "props");
}

export class AnalysisError extends Error {
  static {
    this.prototype.name = "AnalysisError";
  }
}
