import type { NodePath } from "@babel/core";
import type { ObjectProperty, RestElement, VariableDeclaration, VariableDeclarator } from "@babel/types";

export type RemovableNode = ObjectProperty | RestElement | VariableDeclarator | VariableDeclaration;

export class LocalManager {
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
