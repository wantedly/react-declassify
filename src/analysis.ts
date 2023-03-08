import type { NodePath } from "@babel/core";
import type { Scope } from "@babel/traverse";
import type { ArrowFunctionExpression, CallExpression, ClassDeclaration, ClassMethod, ClassPrivateMethod, ClassPrivateProperty, ClassProperty, Expression, FunctionExpression, Identifier, JSXIdentifier, MemberExpression, ThisExpression } from "@babel/types";
import { AnalysisError } from "./analysis/error.js";
import { analyzeThisFields } from "./analysis/sites.js";
import { isClassMethodLike, memberName, memberRefName } from "./utils.js";

export { AnalysisError } from "./analysis/error.js";

export type {
  ComponentHead,
  RefInfo
} from "./analysis/head.js";
export { analyzeHead } from "./analysis/head.js";

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

export type ComponentBody = {
  render: RenderAnalysis;
  state: Map<string, StateField>;
  members: Map<string, MethodAnalysis>;
  thisRefs: ThisRef[];
  propVars: PropVar[];
  propVarNames: Map<string, string>;
  propBinders: PropBinder[];
};

export type StateField = {
  init?: NodePath<Expression>;
  localName: string;
  localSetterName: string;
};

export function analyzeBody(path: NodePath<ClassDeclaration>, babel: typeof import("@babel/core")): ComponentBody {
  const sites = analyzeThisFields(path);
  const locals = analyzeOuterCapturings(path);
  const state = new Map<string, StateField>();
  const thisRefs = analyzeThisRefs(path, state, babel, locals);
  const { propVars, propVarNames, propBinders } = analyzeProps(thisRefs, babel, locals);
  let render: RenderAnalysis | undefined = undefined;
  const members = new Map<string, MethodAnalysis>();
  for (const [name, fieldSites] of sites.entries()) {
    if (name === "render") {
      if (fieldSites.some((site) => site.type === "expr")) {
        throw new AnalysisError(`do not use this.render`);
      }
      const init = fieldSites.find((site) => site.init);
      if (init) {
        if (init.path.isClassMethod()) {
          render = analyzeRender(init.path, babel, locals, propVars);
        }
      }
    } else if (name === "props") {
      // TODO: refactor the logic into here
    } else if (name === "state") {
      const init = fieldSites.find((site) => site.init);
      if (init) {
        const init_ = init.init!;
        if (init_.type !== "init_value") {
          throw new AnalysisError("Non-analyzable state initializer");
        }
        const initPath = init_.valuePath;
        if (!initPath.isObjectExpression()) {
          throw new AnalysisError("Non-analyzable state initializer");
        }
        for (const fieldPath of initPath.get("properties")) {
          if (!fieldPath.isObjectProperty()) {
            throw new AnalysisError("Non-analyzable state initializer");
          }
          const fieldName = memberName(fieldPath.node);
          if (fieldName == null) {
            throw new AnalysisError("Non-analyzable state initializer");
          }
          const fieldInitPath = fieldPath.get("value");
          if (!fieldInitPath.isExpression()) {
            throw new AnalysisError("Non-analyzable state initializer");
          }
          const field = ensureState(state, fieldName, babel, locals);
          field.init = fieldInitPath;
        }
      }
    } else if (name === "setState") {
    } else if (!SPECIAL_MEMBER_NAMES.has(name)) {
      const init = fieldSites.find((site) => site.init);
      if (init) {
        const init_ = init.init!;
        if (isClassMethodLike(init.path)) {
          members.set(name, analyzeMethod(init.path));
        } else if (init_.type === "init_value") {
          const initPath = init_.valuePath;
          if (initPath.isFunctionExpression() || initPath.isArrowFunctionExpression()) {
            members.set(name, analyzeFuncDef(initPath));
          } else {
            throw new AnalysisError(`Non-analyzable initialization of ${name}`);
          }
        } else {
          throw new AnalysisError(`Non-analyzable initialization of ${name}`);
        }
      }
    } else {
      throw new AnalysisError(`Cannot transform ${name}`);
    }
  }
  if (!render) {
    throw new AnalysisError(`Missing render method`);
  }
  return {
    render,
    state,
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
  type: "method";
  path: NodePath<ClassMethod | ClassPrivateMethod>;
} | {
  type: "func_def";
  initPath: NodePath<FunctionExpression | ArrowFunctionExpression>;
};

function analyzeMethod(path: NodePath<ClassMethod | ClassPrivateMethod>): MethodAnalysis {
  return { type: "method", path };
}

function analyzeFuncDef(initPath: NodePath<FunctionExpression | ArrowFunctionExpression>): MethodAnalysis {
  return { type: "func_def", initPath };
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

function analyzeThisRefs(path: NodePath<ClassDeclaration>, state: Map<string, StateField>, babel: typeof import("@babel/core"), locals: Set<string>): ThisRef[] {
  const thisRefs: ThisRef[] = [];
  for (const mem of path.get("body").get("body")) {
    if (mem.isClassMethod()) {
      if (mem.node.static) {
        // TODO
      } else {
        for (const param of mem.get("params")) {
          analyzeThisRefsIn(thisRefs, param, state, babel, locals);
        }
        analyzeThisRefsIn(thisRefs, mem.get("body"), state, babel, locals);
      }
    } else if (mem.isClassProperty()) {
      if (mem.node.static) {
        // TODO
      } else {
        const value = mem.get("value");
        if (value.isExpression()) {
          analyzeThisRefsIn(thisRefs, value, state, babel, locals);
        }
      }
    }
  }
  return thisRefs;
}

function analyzeThisRefsIn(thisRefs: ThisRef[], path: NodePath, state: Map<string, StateField>, babel: typeof import("@babel/core"), locals: Set<string>) {
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
    } else if (name === "state") {
      const gpPath = parentPath.parentPath;
      if (!gpPath.isMemberExpression()) {
        // throw new AnalysisError(`Stray this.state`);
        return;
      }
      const stateName = memberRefName(gpPath.node);
      if (stateName == null) {
        throw new AnalysisError(`Non-analyzable state name`);
      }
      const field = ensureState(state, stateName, babel, locals);
      thisRefs.push({
        kind: "state",
        path: gpPath,
        field,
      });
    } else if (name === "setState") {
      const gpPath = parentPath.parentPath;
      if (!gpPath.isCallExpression()) {
        throw new AnalysisError(`Stray this.setState`);
      }
      const args = gpPath.get("arguments");
      if (args.length !== 1) {
        throw new AnalysisError(`Non-analyzable setState`);
      }
      const arg0 = args[0]!;
      if (arg0.isObjectExpression()) {
        const props = arg0.get("properties");
        if (props.length !== 1) {
          throw new AnalysisError(`Multiple assignments in setState is not yet supported`);
        }
        const prop0 = props[0]!;
        if (!prop0.isObjectProperty()) {
          throw new AnalysisError(`Non-analyzable setState`);
        }
        const setStateName = memberName(prop0.node);
        if (setStateName == null) {
          throw new AnalysisError(`Non-analyzable setState name`);
        }
        const field = ensureState(state, setStateName, babel, locals);
        thisRefs.push({
          kind: "setState",
          path: gpPath,
          field,
          rhs: prop0.get("value") as NodePath<Expression>,
        });
      } else {
        throw new AnalysisError(`Non-analyzable setState`);
      }
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
  kind: "state",
  path: NodePath<MemberExpression>;
  field: StateField,
} | {
  kind: "setState",
  path: NodePath<CallExpression>;
  field: StateField,
  rhs: NodePath<Expression>,
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

function ensureState(state: Map<string, StateField>, name: string, babel: typeof import("@babel/core"), locals: Set<string>): StateField {
  if (!state.has(name)) {
    const localName = newLocal(name, babel, locals);
    const localSetterName = newLocal(`set${name.replace(/^[a-z]/, (s) => s.toUpperCase())}`, babel, locals);
    state.set(name, { localName, localSetterName });
  }
  return state.get(name)!;
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
