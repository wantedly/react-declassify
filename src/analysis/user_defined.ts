import type { NodePath } from "@babel/core";
import { ArrowFunctionExpression, ClassMethod, ClassPrivateMethod, FunctionExpression } from "@babel/types";
import { isClassMethodLike } from "../utils.js";
import { AnalysisError } from "./error.js";
import type { ThisFieldSite } from "./this_fields.js";

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

export type UserDefinedAnalysis = {
  fields: Map<string, UserDefined>;
};

export type UserDefined =
  // | UserDefinedRef
  // | UserDefinedDirectRef
  | UserDefinedFn;

export type UserDefinedFn = {
  type: "user_defined_function";
  localName?: string | undefined;
  init: FnInit;
  sites: ThisFieldSite[];
};

export type FnInit = {
  type: "method";
  path: NodePath<ClassMethod | ClassPrivateMethod>;
} | {
  type: "func_def";
  initPath: NodePath<FunctionExpression | ArrowFunctionExpression>;
};

export function analyzeUserDefined(
  thisFields: Map<string, ThisFieldSite[]>
): UserDefinedAnalysis {
  const fields = new Map<string, UserDefined>();
  for (const [name, fieldSites]  of thisFields) {
    if (SPECIAL_MEMBER_NAMES.has(name)) {
      throw new AnalysisError(`Cannot transform ${name}`);
    }
    let fnInit: FnInit | undefined = undefined;
    const initSite = fieldSites.find((site) => site.init);
    if (initSite) {
      const init = initSite.init!;
      if (isClassMethodLike(initSite.path)) {
        fnInit = {
          type: "method",
          path: initSite.path,
        };
      } else if (init.type === "init_value") {
        const initPath = init.valuePath;
        if (initPath.isFunctionExpression() || initPath.isArrowFunctionExpression()) {
          fnInit = {
            type: "func_def",
            initPath,
          };
        }
      }
    }
    const hasWrite = fieldSites.some((site) => site.hasWrite);
    if (fnInit && !hasWrite) {
      fields.set(name, {
        type: "user_defined_function",
        init: fnInit,
        sites: fieldSites,
      });
    } else {
      throw new AnalysisError("Not implemented yet: ref");
    }
  }
  return { fields };
}
