import type { PluginPass } from "@babel/core";
import type { ClassAccessorProperty, ClassMethod, ClassPrivateMethod, ClassPrivateProperty, ClassProperty, ObjectMethod, ObjectProperty, TSDeclareMethod } from "@babel/types";

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

export function isTS(state: PluginPass): boolean {
  if (state.filename) {
    return /\.(?:[mc]ts|tsx?)$/i.test(state.filename);
  }
  return false;
}
