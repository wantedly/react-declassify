import type { NodePath } from "@babel/core";
import type { Scope } from "@babel/traverse";
import type {
  Expression,
  MemberExpression,
  TSMethodSignature,
  TSPropertySignature,
} from "@babel/types";
import { getOr, memberName } from "../utils.js";
import { AnalysisError } from "./error.js";
import type { LocalManager } from "./local.js";
import { ClassFieldAnalysis } from "./class_fields.js";
import { trackMember } from "./track_member.js";
import { PreAnalysisResult } from "./pre.js";

export type PropsObjAnalysis = {
  hasDefaults: boolean;
  sites: PropsObjSite[];
  props: Map<string, PropAnalysis>;
  allAliases: PropAlias[];
};

export type PropAnalysis = {
  newAliasName?: string | undefined;
  defaultValue?: NodePath<Expression>;
  sites: PropSite[];
  aliases: PropAlias[];
  typing?: NodePath<TSPropertySignature | TSMethodSignature> | undefined;
};

// These are mutually linked
export type PropsObjSite = {
  path: NodePath<MemberExpression>;
  owner: string | undefined;
  decomposedAsAliases: boolean;
  child: PropSite | undefined;
};

export type PropSite = {
  path: NodePath<MemberExpression>;
  parent: PropsObjSite;
  owner: string | undefined;
  enabled: boolean;
};

export type PropAlias = {
  scope: Scope;
  localName: string;
  owner: string | undefined;
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
export function analyzeProps(
  propsObjAnalysis: ClassFieldAnalysis,
  defaultPropsObjAnalysis: ClassFieldAnalysis,
  locals: LocalManager,
  preanalysis: PreAnalysisResult
): PropsObjAnalysis {
  const defaultProps = analyzeDefaultProps(defaultPropsObjAnalysis);
  const newObjSites: PropsObjSite[] = [];
  const props = new Map<string, PropAnalysis>();
  const getProp = (name: string) =>
    getOr(props, name, () => ({
      sites: [],
      aliases: [],
    }));

  for (const site of propsObjAnalysis.sites) {
    if (site.type !== "expr" || site.hasWrite) {
      throw new AnalysisError(`Invalid use of this.props`);
    }
    const memberAnalysis = trackMember(site.path);
    const parentSite: PropsObjSite = {
      path: site.path,
      owner: site.owner,
      decomposedAsAliases: false,
      child: undefined,
    };
    newObjSites.push(parentSite);
    if (memberAnalysis.fullyDecomposed && memberAnalysis.memberAliases) {
      for (const [name, aliasing] of memberAnalysis.memberAliases) {
        getProp(name).aliases.push({
          scope: aliasing.scope,
          localName: aliasing.localName,
          owner: site.owner,
        });
        locals.reserveRemoval(aliasing.idPath);
      }
      parentSite.decomposedAsAliases = true;
    } else {
      if (defaultProps && !memberAnalysis.memberExpr) {
        throw new AnalysisError(
          `Non-analyzable this.props in presence of defaultProps`
        );
      }
      if (memberAnalysis.memberExpr) {
        const child: PropSite = {
          path: memberAnalysis.memberExpr.path,
          parent: parentSite,
          owner: site.owner,
          // `enabled` will also be turned on later in callback analysis
          enabled: !!defaultProps,
        };
        parentSite.child = child;
        getProp(memberAnalysis.memberExpr.name).sites.push(child);
      }
    }
  }
  for (const [name, propTyping] of preanalysis.propsEach) {
    getProp(name).typing = propTyping;
  }
  if (defaultProps) {
    for (const [name, defaultValue] of defaultProps) {
      getProp(name).defaultValue = defaultValue;
    }
  }
  const allAliases = Array.from(props.values()).flatMap((prop) => prop.aliases);
  return {
    hasDefaults: !!defaultProps,
    sites: newObjSites,
    props,
    allAliases,
  };
}

export function needAlias(prop: PropAnalysis): boolean {
  return prop.aliases.length > 0 || prop.sites.some((s) => s.enabled);
}

function analyzeDefaultProps(
  defaultPropsAnalysis: ClassFieldAnalysis
): Map<string, NodePath<Expression>> | undefined {
  for (const site of defaultPropsAnalysis.sites) {
    if (!site.init) {
      throw new AnalysisError(`Invalid use of static defaultState`);
    }
  }

  const defaultPropsFields = new Map<string, NodePath<Expression>>();
  const init = defaultPropsAnalysis.sites.find((site) => site.init);
  if (!init) {
    return;
  }
  const init_ = init.init!;
  if (init_.type !== "init_value") {
    throw new AnalysisError("Non-analyzable defaultProps initializer");
  }
  const initPath = init_.valuePath;
  if (!initPath.isObjectExpression()) {
    throw new AnalysisError("Non-analyzable defaultProps initializer");
  }
  for (const fieldPath of initPath.get("properties")) {
    if (!fieldPath.isObjectProperty()) {
      throw new AnalysisError("Non-analyzable defaultProps initializer");
    }
    const stateName = memberName(fieldPath.node);
    if (stateName == null) {
      throw new AnalysisError("Non-analyzable defaultProps initializer");
    }
    const fieldInitPath = fieldPath.get("value");
    if (!fieldInitPath.isExpression()) {
      throw new AnalysisError("Non-analyzable defaultProps initializer");
    }
    defaultPropsFields.set(stateName, fieldInitPath);
  }
  return defaultPropsFields.size > 0 ? defaultPropsFields : undefined;
}
