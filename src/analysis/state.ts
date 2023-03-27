import type { NodePath } from "@babel/core";
import type { CallExpression, Expression, Identifier, ObjectProperty, RestElement, TSType } from "@babel/types";
import { getOr, memberName } from "../utils.js";
import { AnalysisError } from "./error.js";
import { PreAnalysisResult } from "./pre.js";
import type { LocalManager } from "./local.js";
import type { ClassFieldSite } from "./class_fields.js";
import { trackMember } from "./track_member.js";

export type StateObjAnalysis = Map<string, StateAnalysis>;

export type StateAnalysis = {
  localName?: string | undefined;
  localSetterName?: string | undefined;
  init?: StateInitSite | undefined;
  typeAnnotation?: StateTypeAnnotation;
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
  path: NodePath<Expression>;
};
export type SetStateSite = {
  type: "setState";
  path: NodePath<CallExpression>;
  valuePath: NodePath<Expression>;
}

export type StateTypeAnnotation = {
  type: "simple";
  path: NodePath<TSType>;
} | {
  type: "method";
  params: NodePath<Identifier | RestElement>[];
  returnType: NodePath<TSType>;
};

export function analyzeState(
  stateObjSites: ClassFieldSite[],
  setStateSites: ClassFieldSite[],
  locals: LocalManager,
  preanalysis: PreAnalysisResult,
): StateObjAnalysis {
  const states = new Map<string, StateAnalysis>();
  const getState = (name: string) => getOr(states, name, () => ({
    sites: [],
  }));

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
    const memberAnalysis = trackMember(site.path);
    if (memberAnalysis.fullyDecomposed && memberAnalysis.memberAliases) {
      for (const [name, aliasInfo] of memberAnalysis.memberAliases) {
        const binding = aliasInfo.scope.getBinding(aliasInfo.localName)!;
        locals.reserveRemoval(binding.path);
        for (const path of binding.referencePaths) {
          if (!path.isExpression()) {
            throw new Error("referencePath contains non-Expression");
          }
          getState(name).sites.push({
            type: "expr",
            path,
          });
        }
      }
    } else if (memberAnalysis.memberExpr) {
      getState(memberAnalysis.memberExpr.name).sites.push({
        type: "expr",
        path: memberAnalysis.memberExpr.path,
      });
    } else {
      throw new AnalysisError(`Non-analyzable this.state`);
    }
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
  for (const [name, stateType] of preanalysis.states) {
    const state = getState(name);
    if (stateType.isTSPropertySignature()) {
      const annot = stateType.get("typeAnnotation");
      if (annot.isTSTypeAnnotation()) {
        state.typeAnnotation = {
          type: "simple",
          path: annot.get("typeAnnotation"),
        };
      }
    } else if (stateType.isTSMethodSignature()) {
      const params = stateType.get("parameters");
      const returnAnnot = stateType.get("typeAnnotation");
      if (returnAnnot.isTSTypeAnnotation()) {
        state.typeAnnotation = {
          type: "method",
          params,
          returnType: returnAnnot.get("typeAnnotation"),
        }
      }
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
