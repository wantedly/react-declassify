import type { NodePath } from "@babel/core";
import type { ClassDeclaration, TSType } from "@babel/types";
import { analyzeLibRef, isReactRef, LibRef } from "./lib.js";

export type ComponentHead = {
  superClassRef: LibRef;
  props: NodePath<TSType> | undefined;
};

export function analyzeHead(path: NodePath<ClassDeclaration>): ComponentHead | undefined {
  const superClass = path.get("superClass");
  if (!superClass.isExpression()) {
    return;
  }
  const superClassRef = analyzeLibRef(superClass);
  if (!superClassRef || !isReactRef(superClassRef)) {
    return;
  }
  if (superClassRef.name === "Component" || superClassRef.name === "PureComponent") {
    let props: NodePath<TSType> | undefined;
    const superTypeParameters = path.get("superTypeParameters");
    if (superTypeParameters.isTSTypeParameterInstantiation()) {
      const params = superTypeParameters.get("params");
      if (params.length > 0) {
        props = params[0];
      }
    }
    return { superClassRef, props };
  }
}
