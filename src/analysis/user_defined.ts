import type { NodePath } from "@babel/core";
import { ArrowFunctionExpression, ClassMethod, ClassPrivateMethod, Expression, FunctionExpression, TSType } from "@babel/types";
import { isClassMethodLike, nonNullPath } from "../utils.js";
import { AnalysisError } from "./error.js";
import { analyzeLibRef, isReactRef } from "./lib.js";
import type { ClassFieldSite } from "./class_fields.js";

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
  typeAnnotation?: NodePath<TSType> | undefined;
  sites: ClassFieldSite[];
};
export type UserDefinedDirectRef = {
  type: "user_defined_direct_ref";
  localName?: string | undefined;
  init: NodePath<Expression>;
  typeAnnotation?: NodePath<TSType> | undefined;
  sites: ClassFieldSite[];
};
export type UserDefinedFn = {
  type: "user_defined_function";
  localName?: string | undefined;
  init: FnInit;
  typeAnnotation?: NodePath<TSType> | undefined;
  sites: ClassFieldSite[];
};

export type FnInit = {
  type: "method";
  path: NodePath<ClassMethod | ClassPrivateMethod>;
} | {
  type: "func_def";
  initPath: NodePath<FunctionExpression | ArrowFunctionExpression>;
};

export function analyzeUserDefined(
  instanceFields: Map<string, ClassFieldSite[]>
): UserDefinedAnalysis {
  const fields = new Map<string, UserDefined>();
  for (const [name, fieldSites]  of instanceFields) {
    if (SPECIAL_MEMBER_NAMES.has(name)) {
      throw new AnalysisError(`Cannot transform ${name}`);
    }
    let fnInit: FnInit | undefined = undefined;
    let isRefInit = false;
    let refInitType1: NodePath<TSType> | undefined = undefined;
    let refInitType2: NodePath<TSType> | undefined = undefined;
    let valInit: NodePath<Expression> | undefined = undefined;
    let valInitType: NodePath<TSType> | undefined = undefined;
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
            const typeParameters = nonNullPath(initPath.get("typeParameters"));
            if (typeParameters) {
              const params = typeParameters.get("params");
              if (params.length > 0) {
                // this.foo = React.createRef<HTMLDivElement>();
                //                            ^^^^^^^^^^^^^^
                refInitType1 = params[0]!;
              }
            }
          }
        }
        valInit = initPath;
      }
    }
    const typeSite = fieldSites.find((site) => site.typing);
    if (typeSite) {
      const typing = typeSite.typing!;
      if (typing.type === "type_value") {
        if (typing.valueTypePath.isTSTypeReference()) {
          const lastName =
            typing.valueTypePath.node.typeName.type === "Identifier"
            ? typing.valueTypePath.node.typeName.name
            : typing.valueTypePath.node.typeName.right.name;
          const typeParameters = nonNullPath(typing.valueTypePath.get("typeParameters"));
          if (lastName === "RefObject" && typeParameters) {
            const params = typeParameters.get("params");
            if (params.length > 0) {
              // class C {
              //   foo: React.RefObject<HTMLDivElement>;
              //                        ^^^^^^^^^^^^^^
              // }
              refInitType2 = params[0]!;
            }
          }
        }
        // class C {
        //   foo: HTMLDivElement | null;
        //        ^^^^^^^^^^^^^^^^^^^^^
        // }
        valInitType = typing.valueTypePath;
      }
    }
    const hasWrite = fieldSites.some((site) => site.hasWrite);
    if (fnInit && !hasWrite) {
      fields.set(name, {
        type: "user_defined_function",
        init: fnInit,
        typeAnnotation: valInitType,
        sites: fieldSites,
      });
    } else if (isRefInit && !hasWrite) {
      fields.set(name, {
        type: "user_defined_ref",
        typeAnnotation: refInitType1 ?? refInitType2,
        sites: fieldSites,
      });
    } else if (valInit) {
      fields.set(name, {
        type: "user_defined_direct_ref",
        init: valInit,
        typeAnnotation: valInitType,
        sites: fieldSites,
      });
    } else {
      throw new AnalysisError(`Cannot transform this.${name}`);
    }
  }
  return { fields };
}
