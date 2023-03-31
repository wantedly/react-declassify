import type { NodePath } from "@babel/core";
import type { Scope } from "@babel/traverse";
import type { Expression, Identifier, MemberExpression } from "@babel/types";
import { memberName, memberRefName } from "../utils.js";

export type ObjectExpressionAnalysis = {
  path: NodePath<Expression>;
  memberExpr?: MemberExprInfo | undefined;
  memberAliases?: Map<string, MemberAliasing> | undefined;
  fullyDecomposed: boolean;
};

export type MemberExprInfo = {
  name: string;
  path: NodePath<MemberExpression>;
};

export type MemberAliasing = {
  scope: Scope;
  localName: string;
  idPath: NodePath<Identifier>;
};

export function trackMember(
  path: NodePath<Expression>
): ObjectExpressionAnalysis {
  let memberExpr: MemberExprInfo | undefined = undefined;
  let memberAliases: Map<string, MemberAliasing> | undefined = undefined;
  let fullyDecomposed = false;
  const path1 = path.parentPath;
  if (path1.isMemberExpression({ object: path.node })) {
    // Check for `<expr>.foo`
    const name = memberRefName(path1.node);
    if (name != null) {
      memberExpr = {
        name,
        path: path1,
      };
      const idPath = getSimpleAliasing(path1);
      if (idPath) {
        // Found `const foo = <expr>.foo;`
        memberAliases = new Map<string, MemberAliasing>();
        memberAliases.set(name, {
          scope: idPath.scope,
          localName: idPath.node.name,
          idPath,
        });
        fullyDecomposed = true;
      }
    }
  } else if (path1.isVariableDeclarator({ init: path.node })) {
    const path2 = path1.parentPath;
    if (path2.isVariableDeclaration({ kind: "const" })) {
      // Check for `const { foo } = <expr>;`
      const lvPath = path1.get("id");
      if (lvPath.isObjectPattern()) {
        fullyDecomposed = true;
        memberAliases = new Map<string, MemberAliasing>();
        for (const propPath of lvPath.get("properties")) {
          let ok = false;
          if (propPath.isObjectProperty()) {
            const name = memberName(propPath.node);
            const valuePath = propPath.get("value");
            if (name != null && valuePath.isIdentifier()) {
              ok = true;
              memberAliases.set(name, {
                scope: valuePath.scope,
                localName: valuePath.node.name,
                idPath: valuePath,
              });
            }
          }
          fullyDecomposed &&= ok;
        }
      }
    }
  }
  return { path, memberExpr, memberAliases, fullyDecomposed };
}

function getSimpleAliasing(
  path: NodePath<Expression>
): NodePath<Identifier> | undefined {
  const path1 = path.parentPath;
  if (path1.isVariableDeclarator({ init: path.node })) {
    const path2 = path1.parentPath;
    if (path2.isVariableDeclaration({ kind: "const" })) {
      const idPath = path1.get("id");
      if (idPath.isIdentifier()) {
        return idPath;
      }
    }
  }
  return undefined;
}
