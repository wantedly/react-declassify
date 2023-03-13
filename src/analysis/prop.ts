import type { NodePath } from "@babel/core";
import type { Scope } from "@babel/traverse";
import type { Expression, LVal, MemberExpression } from "@babel/types";
import { memberName, memberRefName } from "../utils.js";
import { AnalysisError } from "./error.js";
import { StaticFieldSite, ThisFieldSite } from "./this_fields.js";

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
  path: NodePath<LVal>,
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
  propsObjSites: ThisFieldSite[],
  defaultPropsObjSites: StaticFieldSite[],
): PropsObjAnalysis {
  const defaultProps = analyzeDefaultProps(defaultPropsObjSites);
  const newObjSites: PropsObjSite[] = [];
  const props = new Map<string, PropAnalysis>();
  function getProp(name: string): PropAnalysis {
    if (!props.has(name)) {
      props.set(name, {
        sites: [],
        aliases: [],
        needsAlias: false,
      });
    }
    return props.get(name)!;
  }

  function analyzePropAliasing(memPath: NodePath<MemberExpression>): { fullyDecomposed: boolean } {
    let fullyDecomposed = true;
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
        return { fullyDecomposed: false };
      }
      const lval = declaratorPath.get("id");
      if (!lval.isIdentifier()) {
        return { fullyDecomposed: false };
      }
      const propName = memberRefName(propPath.node);
      if (propName == null) {
        return { fullyDecomposed: false };
      }
      // const foo = this.props.foo;
      const prop = getProp(propName);
      prop.aliases.push({
        scope: memPath.scope,
        localName: lval.node.name,
        path: lval,
      });
    } else if (
      memPath.parentPath.isVariableDeclarator()
      && memPath.parentPath.node.init === memPath.node
    ) {
      const declaratorPath = memPath.parentPath;
      const declarationPath = memPath.parentPath.parentPath;
      if (!declarationPath.isVariableDeclaration() || declarationPath.node.kind !== "const") {
        return { fullyDecomposed: false };
      }
      const lval = declaratorPath.get("id");
      if (!lval.isObjectPattern()) {
        return { fullyDecomposed: false };
      }

      // const { foo } = this.props;
      for (const lvprop of lval.get("properties")) {
        if (!lvprop.isObjectProperty()) {
          fullyDecomposed = false;
          break;
        }
        const propName = memberName(lvprop.node);
        if (propName == null) {
          fullyDecomposed = false;
          break;
        }
        const prop = getProp(propName);
        if (lvprop.node.value.type === "Identifier") {
          prop.aliases.push({
            scope: memPath.scope,
            localName: lvprop.node.value.name,
            path: lvprop.get("value") as NodePath<LVal>,
          });
        } else {
          fullyDecomposed = false;
        }
      }
    } else {
      fullyDecomposed = false;
    }
    return { fullyDecomposed };
  }

  for (const site of propsObjSites) {
    if (site.type !== "expr" || site.hasWrite) {
      throw new AnalysisError(`Invalid use of this.props`);
    }
    newObjSites.push({
      path: site.path,
    });
    const { fullyDecomposed } = analyzePropAliasing(site.path);
    if (fullyDecomposed) {
      continue;
    }
    if (defaultProps) {
      const propAccess = site.path.parentPath;
      if (!propAccess.isMemberExpression()) {
        throw new AnalysisError(`Stray this.props in presence of defaultProps`);
      }
      const propName = memberRefName(propAccess.node);
      if (propName == null) {
        throw new AnalysisError(`Non-analyzable this.props in presence of defaultProps`);
      }
      getProp(propName).sites.push({ path: propAccess });
    }
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
  defaultPropsSites: StaticFieldSite[],
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

