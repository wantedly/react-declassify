import type { NodePath } from "@babel/core";
import type { BlockStatement, ClassDeclaration, Identifier, Program, TSInterfaceBody, TSMethodSignature, TSPropertySignature, TSType, TSTypeParameterDeclaration } from "@babel/types";
import { memberName, nonNullPath } from "../utils.js";
import { analyzeLibRef, isReactRef, LibRef } from "./lib.js";

export type PreAnalysisResult = {
  name?: Identifier | undefined;
  typeParameters?: NodePath<TSTypeParameterDeclaration> | undefined;
  superClassRef: LibRef;
  isPure: boolean;
  props: NodePath<TSType> | undefined;
  propsEach: Map<string, NodePath<TSPropertySignature | TSMethodSignature>>;
  states: Map<string, NodePath<TSPropertySignature | TSMethodSignature>>;
};

export function preanalyzeClass(path: NodePath<ClassDeclaration>): PreAnalysisResult | undefined {
  if (path.node.leadingComments?.some((comment) => /react-declassify-disable/.test(comment.value))) {
    // Explicitly disabled
    return;
  }
  if (
    path.node.leadingComments?.some((comment) =>
      comment.type === "CommentBlock" &&
      /^\*/.test(comment.value) &&
      /@abstract/.test(comment.value)
    )
    || path.node.abstract
  ) {
    // This is an abstract class to be inherited; do not attempt transformation.
    return;
  }
  const superClass = path.get("superClass");
  if (!superClass.isExpression()) {
    return;
  }
  const superClassRef = analyzeLibRef(superClass);
  if (!superClassRef || !isReactRef(superClassRef)) {
    return;
  }
  if (superClassRef.name === "Component" || superClassRef.name === "PureComponent") {
    const name = path.node.id;
    const typeParameters_ = nonNullPath(path.get("typeParameters"));
    const typeParameters = typeParameters_?.isTSTypeParameterDeclaration() ? typeParameters_ : undefined;
    const isPure = superClassRef.name === "PureComponent";
    let props: NodePath<TSType> | undefined;
    let propsEach: Map<string, NodePath<TSPropertySignature | TSMethodSignature>> | undefined = undefined;
    let states: Map<string, NodePath<TSPropertySignature | TSMethodSignature>> | undefined = undefined;
    const superTypeParameters = path.get("superTypeParameters");
    if (superTypeParameters.isTSTypeParameterInstantiation()) {
      const params = superTypeParameters.get("params");
      if (params.length > 0) {
        props = params[0];
        propsEach = decompose(params[0]!);
      }
      if (params.length > 1) {
        const stateParamPath = params[1]!;
        states = decompose(stateParamPath);
      }
    }
    propsEach ??= new Map();
    states ??= new Map();
    return { name, typeParameters, superClassRef, isPure, props, propsEach, states };
  }
}

function decompose(path: NodePath<TSType>): Map<string, NodePath<TSPropertySignature | TSMethodSignature>> {
  const aliasPath = resolveAlias(path);
  const members =
    aliasPath.isTSTypeLiteral()
    ? aliasPath.get("members")
    : aliasPath.isTSInterfaceBody()
    ? aliasPath.get("body")
    : undefined;
  const decomposed = new Map<string, NodePath<TSPropertySignature | TSMethodSignature>>();
  if (members) {
    for (const member of members) {
      if (member.isTSPropertySignature() || member.isTSMethodSignature()) {
        const name = memberName(member.node);
        if (name != null) {
          decomposed.set(name, member);
        }
      }
    }
  }
  return decomposed;
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
            } else if (body.isTSInterfaceDeclaration() && body.node.id.name === name) {
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
