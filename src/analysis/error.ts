import type { NodePath } from "@babel/traverse";
import type {
  ClassAccessorProperty,
  ClassMethod,
  ClassPrivateMethod,
  ClassPrivateProperty,
  ClassProperty,
  TSDeclareMethod,
  ThisExpression,
} from "@babel/types";

export type SoftError = SoftErrorThisExpr | SoftErrorDecl;
export type SoftErrorThisExpr = {
  type: "invalid_this";
  path: NodePath<ThisExpression>;
};
export type SoftErrorDecl = {
  type: "invalid_decl";
  path: NodePath<
    | ClassProperty
    | ClassPrivateProperty
    | ClassMethod
    | ClassPrivateMethod
    | TSDeclareMethod
    | ClassAccessorProperty
  >;
};

export class SoftErrorRepository {
  errors: SoftError[] = [];
  addThisError(thisPath: NodePath<ThisExpression>) {
    this.errors.push({
      type: "invalid_this",
      path: thisPath,
    });
  }
  addDeclError(
    declPath: NodePath<
      | ClassProperty
      | ClassPrivateProperty
      | ClassMethod
      | ClassPrivateMethod
      | TSDeclareMethod
      | ClassAccessorProperty
    >
  ) {
    this.errors.push({
      type: "invalid_decl",
      path: declPath,
    });
  }
}

export class AnalysisError extends Error {
  static {
    this.prototype.name = "AnalysisError";
  }
}
