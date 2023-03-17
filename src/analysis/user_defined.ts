import type { NodePath } from "@babel/core";
import { ArrowFunctionExpression, ClassMethod, ClassPrivateMethod, Expression, FunctionExpression } from "@babel/types";
import { isClassMethodLike } from "../utils.js";
import { AnalysisError } from "./error.js";
import { analyzeLibRef, isReactRef } from "./lib.js";
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
  | UserDefinedRef
  | UserDefinedDirectRef
  | UserDefinedFn;

export type UserDefinedRef = {
  type: "user_defined_ref";
  localName?: string | undefined;
  sites: ThisFieldSite[];
};
export type UserDefinedDirectRef = {
  type: "user_defined_direct_ref";
  localName?: string | undefined;
  init: NodePath<Expression>;
  sites: ThisFieldSite[];
};
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
    let isRefInit = false;
    let valInit: NodePath<Expression> | undefined = undefined;
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

        if (initPath.isCallExpression()) {
          const initFn = initPath.get("callee") as NodePath<Expression>;
          const initArgs = initPath.get("arguments");
          const initRef = analyzeLibRef(initFn);
          if (initRef && isReactRef(initRef) && initRef.name === "createRef") {
            if (initArgs.length > 0) {
              throw new AnalysisError("Extra arguments to createRef");
            }
            isRefInit = true;
          }
        }
        valInit = initPath;
      }
    }
    const hasWrite = fieldSites.some((site) => site.hasWrite);
    if (fnInit && !hasWrite) {
      fields.set(name, {
        type: "user_defined_function",
        init: fnInit,
        sites: fieldSites,
      });
    } else if (isRefInit && !hasWrite) {
      fields.set(name, {
        type: "user_defined_ref",
        sites: fieldSites,
      });
    } else if (valInit) {
      fields.set(name, {
        type: "user_defined_direct_ref",
        init: valInit,
        sites: fieldSites,
      });
    } else {
      throw new AnalysisError(`Cannot transform this.${name}`);
    }
  }
  return { fields };
}
