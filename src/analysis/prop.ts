import type { NodePath } from "@babel/core";
import type { Scope } from "@babel/traverse";
import type { LVal, MemberExpression } from "@babel/types";
import { memberName, memberRefName } from "../utils.js";
import { AnalysisError } from "./error.js";
import { ThisFieldSite } from "./this_fields.js";

export type PropsObjAnalysis = {
  sites: PropsObjSite[];
  props: Map<string, PropAnalysis>;
  allAliases: PropAlias[];
};

export type PropAnalysis = {
  newAliasName?: string | undefined;
  aliases: PropAlias[];
};

export type PropsObjSite = {
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
  propsObjSites: ThisFieldSite[]
): PropsObjAnalysis {
  const newObjSites: PropsObjSite[] = [];
  const props = new Map<string, PropAnalysis>();
  function getProp(name: string): PropAnalysis {
    if (!props.has(name)) {
      props.set(name, {
        aliases: [],
      });
    }
    return props.get(name)!;
  }

  for (const site of propsObjSites) {
    if (site.type !== "expr" || site.hasWrite) {
      throw new AnalysisError(`Invalid use of this.props`);
    }
    newObjSites.push({
      path: site.path,
    });
    const memPath = site.path;
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
        continue;
      }
      const lval = declaratorPath.get("id");
      if (!lval.isObjectPattern()) {
        continue;
      }

      // const { foo } = this.props;
      for (const lvprop of lval.get("properties")) {
        if (!lvprop.isObjectProperty()) {
          break;
        }
        const propName = memberName(lvprop.node);
        if (propName == null) {
          break;
        }
        const prop = getProp(propName);
        if (lvprop.node.value.type === "Identifier") {
          prop.aliases.push({
            scope: memPath.scope,
            localName: lvprop.node.value.name,
            path: lvprop.get("value") as NodePath<LVal>,
          });
        }
      }
    }
  }
  const allAliases = Array.from(props.values()).flatMap((prop) => prop.aliases);
  return {
    sites: newObjSites,
    props,
    allAliases,
  };
}

