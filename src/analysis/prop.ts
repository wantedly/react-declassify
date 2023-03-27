import type { NodePath } from "@babel/core";
import type { Scope } from "@babel/traverse";
import type { Expression, MemberExpression, TSMethodSignature, TSPropertySignature } from "@babel/types";
import { getOr, memberName } from "../utils.js";
import { AnalysisError } from "./error.js";
import type { LocalManager } from "./local.js";
import { ClassFieldSite } from "./class_fields.js";
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
  /**
   * present only when there is defaultProps.
   */
  sites: PropSite[];
  aliases: PropAlias[];
  needsAlias: boolean;
  typing?: NodePath<TSPropertySignature | TSMethodSignature> | undefined;
};

export type PropsObjSite = {
  path: NodePath<MemberExpression>;
};

export type PropSite = {
  path: NodePath<MemberExpression>;
};

export type PropAlias = {
  scope: Scope,
  localName: string,
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
  propsObjSites: ClassFieldSite[],
  defaultPropsObjSites: ClassFieldSite[],
  locals: LocalManager,
  preanalysis: PreAnalysisResult,
): PropsObjAnalysis {
  const defaultProps = analyzeDefaultProps(defaultPropsObjSites);
  const newObjSites: PropsObjSite[] = [];
  const props = new Map<string, PropAnalysis>();
  const getProp = (name: string) => getOr(props, name, () => ({
    sites: [],
    aliases: [],
    needsAlias: false,
  }));

  for (const site of propsObjSites) {
    if (site.type !== "expr" || site.hasWrite) {
      throw new AnalysisError(`Invalid use of this.props`);
    }
    newObjSites.push({
      path: site.path,
    });
    const memberAnalysis = trackMember(site.path);
    if (memberAnalysis.fullyDecomposed && memberAnalysis.memberAliases) {
      for (const [name, aliasing] of memberAnalysis.memberAliases) {
        getProp(name).aliases.push({
          scope: aliasing.scope,
          localName: aliasing.localName,
        });
        locals.reserveRemoval(aliasing.idPath);
      }
    } else if (defaultProps) {
      if (memberAnalysis.memberExpr) {
        getProp(memberAnalysis.memberExpr.name).sites.push({ path: memberAnalysis.memberExpr.path });
      } else {
        throw new AnalysisError(`Non-analyzable this.props in presence of defaultProps`);
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
  for (const [, prop] of props) {
    prop.needsAlias = prop.aliases.length > 0 || prop.sites.length > 0;
  }
  const allAliases = Array.from(props.values()).flatMap((prop) => prop.aliases);
  return {
    hasDefaults: !!defaultProps,
    sites: newObjSites,
    props,
    allAliases,
  };
}

function analyzeDefaultProps(
  defaultPropsSites: ClassFieldSite[],
): Map<string, NodePath<Expression>> | undefined {
  for (const site of defaultPropsSites) {
    if (!site.init) {
      throw new AnalysisError(`Invalid use of static defaultState`);
    }
  }

  const defaultPropsFields = new Map<string, NodePath<Expression>>();
  const init = defaultPropsSites.find((site) => site.init);
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

