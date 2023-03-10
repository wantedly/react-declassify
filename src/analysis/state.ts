import type { NodePath } from "@babel/core";
import type { AssignmentExpression, CallExpression, ClassAccessorProperty, ClassDeclaration, ClassMethod, ClassPrivateMethod, ClassPrivateProperty, ClassProperty, Expression, ExpressionStatement, MemberExpression, ObjectProperty, ThisExpression, TSDeclareMethod } from "@babel/types";
import { isClassAccessorProperty, isClassMethodLike, isClassMethodOrDecl, isClassPropertyLike, isNamedClassElement, isStaticBlock, memberName, memberRefName, nonNullPath } from "../utils.js";
import { AnalysisError } from "./error.js";
import type { ThisFieldSite } from "./sites.js";

export type StateObjAnalysis = Map<string, StateAnalysis>;

export type StateAnalysis = {
  init?: StateInitSite | undefined;
  sites: StateSite[];
};

export type StateSite = StateInitSite | StateExprSite | SetStateSite;

export type StateInitSite = {
  type: "state_init";
  path: NodePath<ObjectProperty>;
  valuePath: NodePath<Expression>;
};
export type StateExprSite = {
  type: "expr";
  path: NodePath<MemberExpression>;
};
export type SetStateSite = {
  type: "setState";
  path: NodePath<CallExpression>;
  valuePath: NodePath<Expression>;
}

export function analyzeState(
  stateObjSites: ThisFieldSite[],
  setStateSites: ThisFieldSite[],
): StateObjAnalysis {
  const states = new Map<string, StateAnalysis>();
  function getState(name: string): StateAnalysis {
    if (!states.has(name)) {
      states.set(name, {
        sites: [],
      });
    }
    return states.get(name)!;
  }

  const init = stateObjSites.find((site) => site.init);
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
      const stateName = memberName(fieldPath.node);
      if (stateName == null) {
        throw new AnalysisError("Non-analyzable state initializer");
      }
      const fieldInitPath = fieldPath.get("value");
      if (!fieldInitPath.isExpression()) {
        throw new AnalysisError("Non-analyzable state initializer");
      }
      const state = getState(stateName);
      state.sites.push({
        type: "state_init",
        path: fieldPath,
        valuePath: fieldInitPath,
      });
    }
  }
  for (const site of stateObjSites) {
    if (site.init) {
      continue;
    }
    if (site.type !== "expr" || site.hasWrite) {
      throw new AnalysisError(`Invalid use of this.state`);
    }
    const gpPath = site.path.parentPath;
    if (!gpPath.isMemberExpression()) {
      throw new AnalysisError(`Stray this.state`);
    }
    const stateName = memberRefName(gpPath.node);
    if (stateName == null) {
      throw new AnalysisError(`Non-analyzable state name`);
    }
    const state = getState(stateName);
    state.sites.push({
      type: "expr",
      path: gpPath,
    });
  }
  for (const site of setStateSites) {
    if (site.type !== "expr" || site.hasWrite) {
      throw new AnalysisError(`Invalid use of this.setState`);
    }
    const gpPath = site.path.parentPath;
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
      const state = getState(setStateName);
      state.sites.push({
        type: "setState",
        path: gpPath,
        valuePath: prop0.get("value") as NodePath<Expression>,
      });
    } else {
      throw new AnalysisError(`Non-analyzable setState`);
    }
  }
  for (const [name, state] of states.entries()) {
    const numInits = state.sites.reduce((n, site) => n + Number(site.type === "state_init"), 0);
    if (numInits > 1) {
      throw new AnalysisError(`${name} is initialized more than once`);
    }
    state.init = state.sites.find((site): site is StateInitSite => site.type === "state_init");
  }
  return states;
}
