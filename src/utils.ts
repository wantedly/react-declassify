import type { NodePath, PluginPass } from "@babel/core";
import type { ArrayPattern, AssignmentPattern, ClassAccessorProperty, ClassMethod, ClassPrivateMethod, ClassPrivateProperty, ClassProperty, Identifier, MemberExpression, ObjectMethod, ObjectPattern, ObjectProperty, RestElement, StaticBlock, StringLiteral, TSDeclareMethod, TSTypeAnnotation } from "@babel/types";

export function memberName(member: ClassMethod | ClassPrivateMethod | ClassProperty | ClassPrivateProperty | ClassAccessorProperty | TSDeclareMethod | ObjectMethod | ObjectProperty): string | undefined {
  const computed = member.type === "ClassPrivateMethod" || member.type === "ClassPrivateProperty"
    ? false
    : member.computed;
  if (computed && member.key.type === "StringLiteral") {
    return member.key.value;
  } else if (!computed && member.key.type === "Identifier") {
    return member.key.name;
  }
}

export function memberRefName(member: MemberExpression): string | undefined {
  if (member.computed && member.property.type === "StringLiteral") {
    return member.property.value;
  } else if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
}

export function importName(name: Identifier | StringLiteral): string {
  if (name.type === "StringLiteral") {
    return name.value;
  } else {
    return name.name;
  }
}

export function nonNullPath<T>(path: NodePath<T | null | undefined>): NodePath<T> | undefined {
  return path.node ? path as NodePath<T> : undefined;
}

export function isNamedClassElement(path: NodePath): path is NodePath<ClassProperty | ClassPrivateProperty | ClassMethod | ClassPrivateMethod | TSDeclareMethod | ClassAccessorProperty> {
  return path.isClassProperty()
    || path.isClassPrivateProperty()
    || path.isClassMethod()
    || path.isClassPrivateMethod()
    || path.isTSDeclareMethod()
    || isClassAccessorProperty(path);
}

export function isClassPropertyLike(path: NodePath): path is NodePath<ClassProperty | ClassPrivateProperty> {
  return path.isClassProperty() || path.isClassPrivateProperty();
}

export function isClassMethodLike(path: NodePath): path is NodePath<ClassMethod | ClassPrivateMethod> {
  return path.isClassMethod() || path.isClassPrivateMethod();
}

export function isClassMethodOrDecl(path: NodePath): path is NodePath<ClassMethod | ClassPrivateMethod | TSDeclareMethod> {
  return path.isClassMethod() || path.isClassPrivateMethod() || path.isTSDeclareMethod();
}

export function isStaticBlock(path: NodePath): path is NodePath<StaticBlock> {
  return path.node.type === "StaticBlock";
}

export function isClassAccessorProperty(path: NodePath): path is NodePath<ClassAccessorProperty> {
  return path.node.type === "ClassAccessorProperty";
}

export function isTS(state: PluginPass): boolean {
  if (state.filename) {
    return /\.(?:[mc]ts|tsx?)$/i.test(state.filename);
  }
  return false;
}

type Annotatable =
  Identifier | AssignmentPattern | ArrayPattern | ObjectPattern | RestElement | ClassProperty | ClassAccessorProperty | ClassPrivateProperty;

export function assignTypeAnnotation<T extends Annotatable>(
  node: T,
  typeAnnotation: TSTypeAnnotation | null | undefined,
): T {
  return Object.assign(node, {
    typeAnnotation,
  });
}
