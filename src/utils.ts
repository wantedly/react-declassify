import type { NodePath, PluginPass } from "@babel/core";
import type {
  ArrayPattern,
  ArrowFunctionExpression,
  AssignmentPattern,
  CallExpression,
  ClassAccessorProperty,
  ClassDeclaration,
  ClassExpression,
  ClassMethod,
  ClassPrivateMethod,
  ClassPrivateProperty,
  ClassProperty,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  JSXOpeningElement,
  MemberExpression,
  NewExpression,
  Noop,
  ObjectMethod,
  ObjectPattern,
  ObjectProperty,
  OptionalCallExpression,
  RestElement,
  StaticBlock,
  StringLiteral,
  TaggedTemplateExpression,
  TSCallSignatureDeclaration,
  TSConstructorType,
  TSConstructSignatureDeclaration,
  TSDeclareFunction,
  TSDeclareMethod,
  TSExpressionWithTypeArguments,
  TSFunctionType,
  TSImportType,
  TSInstantiationExpression,
  TSInterfaceDeclaration,
  TSMethodSignature,
  TSPropertySignature,
  TSTypeAliasDeclaration,
  TSTypeAnnotation,
  TSTypeParameterDeclaration,
  TSTypeParameterInstantiation,
  TSTypeQuery,
  TSTypeReference,
  TypeAnnotation,
} from "@babel/types";

export function getOr<K, V>(m: Map<K, V>, k: K, getDefault: () => V): V {
  if (m.has(k)) {
    return m.get(k)!;
  } else {
    const v = getDefault();
    m.set(k, v);
    return v;
  }
}

export function getAndDelete<K, V>(m: Map<K, V>, k: K): V | undefined {
  const v = m.get(k);
  m.delete(k);
  return v;
}

export function memberName(
  member:
    | ClassMethod
    | ClassPrivateMethod
    | ClassProperty
    | ClassPrivateProperty
    | ClassAccessorProperty
    | TSDeclareMethod
    | ObjectMethod
    | ObjectProperty
    | TSPropertySignature
    | TSMethodSignature
): string | undefined {
  const computed =
    member.type === "ClassPrivateMethod" ||
    member.type === "ClassPrivateProperty"
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

export function memberFromDecl(
  babel: typeof import("@babel/core"),
  object: Expression,
  decl:
    | ClassMethod
    | ClassPrivateMethod
    | ClassProperty
    | ClassPrivateProperty
    | ClassAccessorProperty
    | TSDeclareMethod
    | ObjectMethod
    | ObjectProperty
    | TSPropertySignature
    | TSMethodSignature
): MemberExpression {
  const { types: t } = babel;
  if (
    decl.type === "ClassPrivateMethod" ||
    decl.type === "ClassPrivateProperty"
  ) {
    return t.memberExpression(object, t.stringLiteral(decl.key.id.name), true);
  }
  if (decl.key.type === "PrivateName") {
    return t.memberExpression(object, t.stringLiteral(decl.key.id.name), true);
  }
  return t.memberExpression(object, decl.key, decl.computed);
}

export function nonNullPath<T>(
  path: NodePath<T | null | undefined>
): NodePath<T> | undefined {
  return path.node ? (path as NodePath<T>) : undefined;
}

export function isNamedClassElement(
  path: NodePath
): path is NodePath<
  | ClassProperty
  | ClassPrivateProperty
  | ClassMethod
  | ClassPrivateMethod
  | TSDeclareMethod
  | ClassAccessorProperty
> {
  return (
    path.isClassProperty() ||
    path.isClassPrivateProperty() ||
    path.isClassMethod() ||
    path.isClassPrivateMethod() ||
    path.isTSDeclareMethod() ||
    isClassAccessorProperty(path)
  );
}

export function isClassPropertyLike(
  path: NodePath
): path is NodePath<ClassProperty | ClassPrivateProperty> {
  return path.isClassProperty() || path.isClassPrivateProperty();
}

export function isClassMethodLike(
  path: NodePath
): path is NodePath<ClassMethod | ClassPrivateMethod> {
  return path.isClassMethod() || path.isClassPrivateMethod();
}

export function isClassMethodOrDecl(
  path: NodePath
): path is NodePath<ClassMethod | ClassPrivateMethod | TSDeclareMethod> {
  return (
    path.isClassMethod() ||
    path.isClassPrivateMethod() ||
    path.isTSDeclareMethod()
  );
}

export function isStaticBlock(path: NodePath): path is NodePath<StaticBlock> {
  return path.node.type === "StaticBlock";
}

export function isClassAccessorProperty(
  path: NodePath
): path is NodePath<ClassAccessorProperty> {
  return path.node.type === "ClassAccessorProperty";
}

export function isTS(state: PluginPass): boolean {
  if (state.filename) {
    return /\.(?:[mc]ts|tsx?)$/i.test(state.filename);
  }
  return false;
}

type Annotatable =
  | Identifier
  | AssignmentPattern
  | ArrayPattern
  | ObjectPattern
  | RestElement
  | ClassProperty
  | ClassAccessorProperty
  | ClassPrivateProperty;

export function assignTypeAnnotation<T extends Annotatable>(
  node: T,
  typeAnnotation: TSTypeAnnotation | null | undefined
): T {
  return Object.assign(node, {
    typeAnnotation,
  });
}

type ReturnTypeable =
  | FunctionDeclaration
  | FunctionExpression
  | TSDeclareFunction
  | ArrowFunctionExpression
  | ObjectMethod
  | ClassMethod
  | ClassPrivateMethod
  | TSDeclareMethod;

export function assignReturnType<T extends ReturnTypeable>(
  node: T,
  returnType: TypeAnnotation | TSTypeAnnotation | Noop | null | undefined
): T {
  return Object.assign(node, {
    returnType,
  });
}

type Paramable =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunctionExpression
  | TSDeclareFunction
  | ObjectMethod
  | ClassMethod
  | ClassPrivateMethod
  | TSDeclareMethod
  | ClassDeclaration
  | ClassExpression
  | TSCallSignatureDeclaration
  | TSConstructSignatureDeclaration
  | TSMethodSignature
  | TSFunctionType
  | TSConstructorType
  | TSInterfaceDeclaration
  | TSTypeAliasDeclaration;

export function assignTypeParameters<T extends Paramable>(
  node: T,
  typeParameters: TSTypeParameterDeclaration | null | undefined
): T {
  return Object.assign(node, {
    typeParameters,
  });
}

type Arguable =
  | CallExpression
  | NewExpression
  | TaggedTemplateExpression
  | OptionalCallExpression
  | JSXOpeningElement
  | TSTypeReference
  | TSTypeQuery
  | TSExpressionWithTypeArguments
  | TSInstantiationExpression
  | TSImportType;

export function assignTypeArguments<T extends Arguable>(
  node: T,
  typeParameters: TSTypeParameterInstantiation | null | undefined
): T {
  return Object.assign(node, {
    typeParameters,
  });
}
