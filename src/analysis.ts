import type { NodePath } from "@babel/core";
import type { Scope } from "@babel/traverse";
import type { ArrowFunctionExpression, CallExpression, ClassDeclaration, ClassMethod, ClassPrivateMethod, ClassPrivateProperty, ClassProperty, Expression, FunctionExpression, Identifier, JSXIdentifier, MemberExpression, ThisExpression } from "@babel/types";
import { AnalysisError } from "./analysis/error.js";
import { analyzeThisFields } from "./analysis/this_fields.js";
import { analyzeState, StateObjAnalysis } from "./analysis/state.js";
import { getAndDelete, getOr, isClassMethodLike, memberName, memberRefName } from "./utils.js";
import { analyzeProps, PropsObjAnalysis } from "./analysis/prop.js";
import { LocalManager, RemovableNode } from "./analysis/local.js";

export { AnalysisError } from "./analysis/error.js";

export type {
  ComponentHead,
  RefInfo
} from "./analysis/head.js";
export { analyzeHead } from "./analysis/head.js";
export type { LocalManager } from "./analysis/local.js";
export type { StateObjAnalysis } from "./analysis/state.js";
export type { PropsObjAnalysis } from "./analysis/prop.js";

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
  locals: LocalManager,
  render: RenderAnalysis;
  state: StateObjAnalysis;
  members: Map<string, MethodAnalysis>;
  thisRefs: ThisRef[];
  props: PropsObjAnalysis;
};

export function analyzeBody(path: NodePath<ClassDeclaration>, babel: typeof import("@babel/core")): ComponentBody {
  const locals2 = new LocalManager();
  const { thisFields: sites, staticFields } = analyzeThisFields(path);

  const propsObjSites = getAndDelete(sites, "props") ?? [];
  const defaultPropsObjSites = getAndDelete(staticFields, "defaultProps") ?? [];

  const stateObjSites = getAndDelete(sites, "state") ?? [];
  const setStateSites = getAndDelete(sites, "setState") ?? [];
  const states = analyzeState(stateObjSites, setStateSites, locals2);

  const locals = analyzeOuterCapturings(path);
  let renderPath: NodePath<ClassMethod> | undefined = undefined;
  const members = new Map<string, MethodAnalysis>();
  const thisRefs: ThisRef[] = [];
  for (const [name, fieldSites] of sites.entries()) {
    if (name === "render") {
      if (fieldSites.some((site) => site.type === "expr")) {
        throw new AnalysisError(`do not use this.render`);
      }
      const init = fieldSites.find((site) => site.init);
      if (init) {
        if (init.path.isClassMethod()) {
          renderPath = init.path;
        }
      }
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
      for (const site of fieldSites) {
        if (site.init) {
          continue;
        }
        if (site.type !== "expr" || site.hasWrite) {
          throw new AnalysisError(`Invalid use of this.${name}`);
        }
        thisRefs.push({
          kind: "userDefined",
          path: site.path,
          name,
        });
      }
    } else {
      throw new AnalysisError(`Cannot transform ${name}`);
    }
  }
  for (const [name] of staticFields) {
    if (!SPECIAL_STATIC_NAMES.has(name)) {
      throw new AnalysisError(`Cannot transform static ${name}`);
    } else {
      throw new AnalysisError(`Cannot transform static ${name}`);
    }
  }
  if (!renderPath) {
    throw new AnalysisError(`Missing render method`);
  }
  const props = analyzeProps(propsObjSites, defaultPropsObjSites);
  for (const [name, propAnalysis] of props.props) {
    if (propAnalysis.needsAlias) {
      propAnalysis.newAliasName = newLocal(name, babel, locals);
    }
  }

  const render = analyzeRender(renderPath, babel, locals, props, locals2);

  for (const [name, stateAnalysis] of states.entries()) {
    stateAnalysis.localName = newLocal(name, babel, locals);
    stateAnalysis.localSetterName = newLocal(`set${name.replace(/^[a-z]/, (s) => s.toUpperCase())}`, babel, locals);
  }

  return {
    locals: locals2,
    render,
    state: states,
    members,
    thisRefs,
    props,
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
  props: PropsObjAnalysis,
  locals2: LocalManager,
): RenderAnalysis {
  console.log("locals2 =", locals2);
  const renames: LocalRename[] = [];
  for (const [name, binding] of Object.entries(path.scope.bindings)) {
    if (
      props.allAliases.some((alias) => alias.scope === binding.scope && alias.localName === name)
    ) {
      // Already handled as a prop alias
      continue;
    }
    if (
      locals2.allRemovePaths.has(binding.path as NodePath<RemovableNode>)
    ) {
      // Already handled as an alias
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

export type ThisRef = {
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
  return body.props.sites.length > 0;
}
