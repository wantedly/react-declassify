import type { NodePath } from "@babel/core";
import type { ObjectProperty, RestElement, VariableDeclaration, VariableDeclarator } from "@babel/types";

// const RE_IDENT = /^[\p{ID_Start}_$][\p{ID_Continue}$\u200C\u200D]*$/u;
const RESERVED: ReadonlySet<string> = new Set<string>([
  // Pure reserved words
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  // Strict mode reserved
  "arguments",
  "enum",
  "eval",
  "implements",
  "interface",
  "let",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "yield",
  // Module-level reserved
  "await",
]);

export type RemovableNode = ObjectProperty | RestElement | VariableDeclarator | VariableDeclaration;

export class LocalManager {
  assigned = new Set<string>();
  markCaptured(name: string) {
    this.assigned.add(name);
  }
  newLocal(baseName: string): string {
    let name = baseName.replace(/[^\p{ID_Continue}$\u200C\u200D]/gu, "");
    if (!/^[\p{ID_Start}_$]/u.test(name) || RESERVED.has(name)) {
      name = `_${name}`;
    }
    if (this.assigned.has(name)) {
      name = name.replace(/\d+$/, "");
      for (let i = 0;; i++) {
        if (i >= 1000000) {
          throw new Error("Unexpected infinite loop");
        }
        if (!this.assigned.has(`${name}${i}`)) {
          name = `${name}${i}`;
          break;
        }
      }
    }
    this.assigned.add(name);
    return name;
  }

  removePaths = new Set<NodePath<RemovableNode>>();
  allRemovePaths = new Set<NodePath<RemovableNode>>();
  reserveRemoval(path: NodePath): boolean {
    const cPath = canonicalRemoveTarget(path);
    if (!cPath) {
      return false;
    }
    this.allRemovePaths.add(cPath);
    this.removePaths.add(cPath);
    const path1 = cPath.parentPath;
    if (!path1) {
      return true;
    }
    if (path1.isObjectPattern()) {
      this.tryPromote(path1.get("properties"), path1);
    } else if (path1.isVariableDeclaration()) {
      this.tryPromote(path1.get("declarations"), path1);
    }
    return true;
  }
  // Try to remove the parent node instead
  tryPromote(subPaths: NodePath<RemovableNode>[], path: NodePath) {
    if (subPaths.every((subPath) => this.removePaths.has(subPath))) {
      const promoted = this.reserveRemoval(path);
      if (promoted) {
        for (const subPath of subPaths) {
          this.removePaths.delete(subPath);
        }
      }
    }
  }
}

function canonicalRemoveTarget(path: NodePath): NodePath<RemovableNode> | undefined {
  if (path.isIdentifier() || path.isObjectPattern()) {
    if (path.parentPath.isObjectProperty({ value: path.node })) {
      return path.parentPath;
    } else if (path.parentPath.isVariableDeclarator({ id: path.node })) {
      return path.parentPath;
    }
  } else if (path.isObjectProperty()) {
    return path;
  } else if (path.isVariableDeclarator()) {
    return path;
  }
}
