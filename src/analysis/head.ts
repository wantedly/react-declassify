import type { NodePath } from "@babel/core";
import type { BlockStatement, ClassDeclaration, Program, TSInterfaceBody, TSMethodSignature, TSPropertySignature, TSType } from "@babel/types";
import { memberName } from "../utils.js";
import { analyzeLibRef, isReactRef, LibRef } from "./lib.js";

export type ComponentHead = {
  superClassRef: LibRef;
  props: NodePath<TSType> | undefined;
  states: Map<string, NodePath<TSPropertySignature | TSMethodSignature>>;
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
    const states = new Map<string, NodePath<TSPropertySignature | TSMethodSignature>>();
    const superTypeParameters = path.get("superTypeParameters");
    if (superTypeParameters.isTSTypeParameterInstantiation()) {
      const params = superTypeParameters.get("params");
      if (params.length > 0) {
        props = params[0];
      }
      if (params.length > 1) {
        const stateParamPath = params[1]!;
        const statePath = resolveAlias(stateParamPath);
        const members =
          statePath.isTSTypeLiteral()
          ? statePath.get("members")
          : statePath.isTSInterfaceBody()
          ? statePath.get("body")
          : undefined;
        if (members) {
          for (const member of members) {
            if (member.isTSPropertySignature() || member.isTSMethodSignature()) {
              const name = memberName(member.node);
              if (name != null) {
                states.set(name, member);
              }
            }
          }
        }
      }
    }
    return { superClassRef, props, states };
  }
}

function resolveAlias(path: NodePath<TSType>): NodePath<TSType | TSInterfaceBody> {
  if (path.isTSTypeReference()) {
    const typeNamePath = path.get("typeName");
    if (typeNamePath.isIdentifier()) {
      const name = typeNamePath.node.name;
      let scope = typeNamePath.scope;
      while (scope) {
        if (scope.path.isBlockStatement() || scope.path.isProgram()) {
          const path_: NodePath<BlockStatement | Program> = scope.path;
          for (const body of path_.get("body")) {
            if (body.isTSTypeAliasDeclaration() && body.node.id.name === name) {
              return body.get("typeAnnotation");
            } else if (body.isTSInterfaceDeclaration()) {
              return body.get("body");
            }
          }
        }
        scope = scope.parent;
      }
    }
  }
  return path;
}
