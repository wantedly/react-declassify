import type { NodePath } from "@babel/core";
import type { Scope } from "@babel/traverse";
import type {
  ClassDeclaration,
  ClassMethod,
  Identifier,
  JSXIdentifier,
  TSType,
  TSTypeParameterDeclaration,
} from "@babel/types";
import { AnalysisError, SoftErrorRepository } from "./analysis/error.js";
import { BindThisSite, analyzeClassFields } from "./analysis/class_fields.js";
import { analyzeState, StateObjAnalysis } from "./analysis/state.js";
import { getAndDelete } from "./utils.js";
import { analyzeProps, needAlias, PropsObjAnalysis } from "./analysis/prop.js";
import { LocalManager, RemovableNode } from "./analysis/local.js";
import {
  analyzeUserDefined,
  postAnalyzeCallbackDependencies,
  UserDefinedAnalysis,
} from "./analysis/user_defined.js";
import type { PreAnalysisResult } from "./analysis/pre.js";
import type { LibRef } from "./analysis/lib.js";
import { EffectAnalysis, analyzeEffects } from "./analysis/effect.js";

export { AnalysisError, SoftErrorRepository } from "./analysis/error.js";

export type { LibRef } from "./analysis/lib.js";
export type { PreAnalysisResult } from "./analysis/pre.js";
export { preanalyzeClass } from "./analysis/pre.js";
export type { LocalManager } from "./analysis/local.js";
export type {
  StateObjAnalysis,
  SetStateSite,
  SetStateFieldSite,
} from "./analysis/state.js";
export { needAlias } from "./analysis/prop.js";
export type { PropsObjAnalysis } from "./analysis/prop.js";

const SPECIAL_STATIC_NAMES = new Set<string>([
  "childContextTypes",
  "contextTypes",
  "contextType",
  "defaultProps",
  "getDerivedStateFromError",
  "getDerivedStateFromProps",
]);

export type AnalysisResult = {
  name?: Identifier | undefined;
  typeParameters?: NodePath<TSTypeParameterDeclaration> | undefined;
  superClassRef: LibRef;
  isPure: boolean;
  propsTyping: NodePath<TSType> | undefined;
  locals: LocalManager;
  render: RenderAnalysis;
  state: StateObjAnalysis;
  props: PropsObjAnalysis;
  userDefined: UserDefinedAnalysis;
  effects: EffectAnalysis;
  bindThisSites: BindThisSite[];
};

export function analyzeClass(
  path: NodePath<ClassDeclaration>,
  preanalysis: PreAnalysisResult,
  softErrors: SoftErrorRepository
): AnalysisResult {
  const locals = new LocalManager(path);
  const {
    instanceFields: sites,
    staticFields,
    bindThisSites,
  } = analyzeClassFields(path, softErrors);

  const propsObjAnalysis = getAndDelete(sites, "props") ?? { sites: [] };
  const defaultPropsObjAnalysis = getAndDelete(
    staticFields,
    "defaultProps"
  ) ?? { sites: [] };

  const stateObjAnalysis = getAndDelete(sites, "state") ?? { sites: [] };
  const setStateAnalysis = getAndDelete(sites, "setState") ?? { sites: [] };
  const states = analyzeState(
    stateObjAnalysis,
    setStateAnalysis,
    locals,
    softErrors,
    preanalysis
  );

  const componentDidMount = getAndDelete(sites, "componentDidMount") ?? {
    sites: [],
  };
  const componentDidUpdate = getAndDelete(sites, "componentDidUpdate") ?? {
    sites: [],
  };
  const componentWillUnmount = getAndDelete(sites, "componentWillUnmount") ?? {
    sites: [],
  };

  const renderAnalysis = getAndDelete(sites, "render") ?? { sites: [] };

  analyzeOuterCapturings(path, locals);
  let renderPath: NodePath<ClassMethod> | undefined = undefined;
  {
    for (const site of renderAnalysis.sites) {
      if (site.type === "expr") {
        softErrors.addThisError(site.thisPath);
      }
    }
    const init = renderAnalysis.sites.find((site) => site.init);
    if (init) {
      if (init.path.isClassMethod()) {
        renderPath = init.path;
      }
    }
  }
  const userDefined = analyzeUserDefined(sites, softErrors);
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
  const props = analyzeProps(
    propsObjAnalysis,
    defaultPropsObjAnalysis,
    locals,
    softErrors,
    preanalysis
  );
  postAnalyzeCallbackDependencies(userDefined, props, states, sites);

  for (const [name, propAnalysis] of props.props) {
    if (needAlias(propAnalysis)) {
      propAnalysis.newAliasName = locals.newLocal(
        name,
        propAnalysis.sites.map((site) => site.path)
      );
    }
  }

  const effects = analyzeEffects(
    componentDidMount,
    componentDidUpdate,
    componentWillUnmount,
    userDefined
  );

  const render = analyzeRender(renderPath, locals);

  for (const [name, stateAnalysis] of states.states.entries()) {
    const bindingPaths = stateAnalysis.sites.map((site) => site.path);
    stateAnalysis.localName = locals.newLocal(name, bindingPaths);
    stateAnalysis.localSetterName = locals.newLocal(
      `set${name.replace(/^[a-z]/, (s) => s.toUpperCase())}`,
      bindingPaths
    );
  }

  for (const [name, field] of userDefined.fields) {
    field.localName = locals.newLocal(
      name,
      field.sites.map((site) => site.path)
    );
  }

  if (effects.cdmPath || effects.cduPath || effects.cwuPath) {
    effects.isMountedLocalName = locals.newLocal("isMounted", []);
    if (effects.cwuPath) {
      effects.cleanupLocalName = locals.newLocal("cleanup", []);
    }
  }

  return {
    name: preanalysis.name,
    typeParameters: preanalysis.typeParameters,
    superClassRef: preanalysis.superClassRef,
    isPure: preanalysis.isPure,
    propsTyping: preanalysis.props,
    locals,
    render,
    state: states,
    props,
    userDefined,
    effects,
    bindThisSites,
  };
}

export type RenderAnalysis = {
  path: NodePath<ClassMethod>;
  renames: LocalRename[];
};

export type LocalRename = {
  scope: Scope;
  oldName: string;
  newName: string;
};

function analyzeRender(
  path: NodePath<ClassMethod>,
  locals: LocalManager
): RenderAnalysis {
  const renames: LocalRename[] = [];
  for (const [name, binding] of Object.entries(path.scope.bindings)) {
    if (locals.allRemovePaths.has(binding.path as NodePath<RemovableNode>)) {
      // Already handled as an alias
      continue;
    }
    const newName = locals.newLocal(name, []);
    renames.push({
      scope: binding.scope,
      oldName: name,
      newName,
    });
  }
  return { path, renames };
}

function analyzeOuterCapturings(
  classPath: NodePath<ClassDeclaration>,
  locals: LocalManager
): Set<string> {
  const capturings = new Set<string>();
  function visitIdent(path: NodePath<Identifier | JSXIdentifier>) {
    const binding = path.scope.getBinding(path.node.name);
    if (!binding || binding.path.isAncestor(classPath)) {
      capturings.add(path.node.name);
      locals.markCaptured(path.node.name);
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
    },
  });
  return capturings;
}

export function needsProps(analysis: AnalysisResult): boolean {
  return analysis.props.sites.length > 0;
}
