import type { PluginPass } from "@babel/core";
import type { ClassAccessorProperty, ClassMethod, ClassPrivateMethod, ClassPrivateProperty, ClassProperty, Identifier, MemberExpression, ObjectMethod, ObjectProperty, StringLiteral, TSDeclareMethod } from "@babel/types";

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

export function isTS(state: PluginPass): boolean {
  if (state.filename) {
    return /\.(?:[mc]ts|tsx?)$/i.test(state.filename);
  }
  return false;
}
