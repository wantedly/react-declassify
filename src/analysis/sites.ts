import type { NodePath } from "@babel/core";
import type { ClassAccessorProperty, ClassDeclaration, ClassMethod, ClassPrivateMethod, ClassPrivateProperty, ClassProperty, Expression, ThisExpression, TSDeclareMethod } from "@babel/types";
import { isClassAccessorProperty, isStaticBlock, memberName, memberRefName } from "../utils.js";
import { AnalysisError } from "./error.js";

export type ThisFields = Map<string, ThisFieldSite[]>;

export type ThisFieldSite = {
  type: "class_field";
  path: NodePath<ClassProperty | ClassPrivateProperty | ClassMethod | ClassPrivateMethod | ClassAccessorProperty | TSDeclareMethod>;
  hasType: boolean;
  hasInit: boolean;
  hasWrite: undefined;
  hasSideEffect: boolean;
} | {
  type: "expr";
  path: NodePath<Expression>;
  hasType: undefined;
  hasInit: undefined;
  hasWrite: boolean;
  hasSideEffect: undefined;
};

export function analyzeThisFields(path: NodePath<ClassDeclaration>): ThisFields {
  const fields = new Map<string, ThisFieldSite[]>();
  // 1st pass: look for class field definitions
  for (const itemPath of path.get("body").get("body")) {
    if (
      itemPath.isClassProperty()
      || itemPath.isClassPrivateProperty()
      || itemPath.isClassMethod()
      || itemPath.isClassPrivateMethod()
      || isClassAccessorProperty(itemPath)
      || itemPath.isTSDeclareMethod()
    ) {
      if (itemPath.node.static) {
        throw new AnalysisError(`Not implemented yet: static`);
      }
      const name = memberName(itemPath.node);
      if (name == null) {
        throw new AnalysisError(`Unnamed class element`);
      }
      if (!fields.has(name)) {
        fields.set(name, []);
      }
      const field = fields.get(name)!;
      if (itemPath.isClassProperty() || itemPath.isClassPrivateProperty()) {
        field.push({
          type: "class_field",
          path: itemPath,
          hasType: !!itemPath.node.typeAnnotation,
          hasInit: !!itemPath.node.value,
          hasWrite: undefined,
          hasSideEffect: !!itemPath.node.value && estimateSideEffect(itemPath.node.value),
        });
      } else if (itemPath.isClassMethod() || itemPath.isClassPrivateMethod() || itemPath.isTSDeclareMethod()) {
        const kind = itemPath.node.kind ?? "method";
        if (kind === "method") {
          field.push({
            type: "class_field",
            path: itemPath,
            hasType: itemPath.isTSDeclareMethod(),
            hasInit: !itemPath.isTSDeclareMethod(),
            hasWrite: undefined,
            hasSideEffect: false,
          });
        } else if (kind === "get" || kind === "set") {
          throw new AnalysisError(`Not implemented yet: getter / setter`);
        } else if (kind === "constructor") {
          throw new AnalysisError(`Not implemented yet: constructor`);
        } else {
          throw new AnalysisError(`Not implemented yet: ${kind}`);
        }
      } else if (isClassAccessorProperty(itemPath)) {
        throw new AnalysisError(`Not implemented yet: class accessor property`);
      }
    } else if (isStaticBlock(itemPath)) {
      throw new AnalysisError(`Not implemented yet: static block`);
    } else if (itemPath.isTSIndexSignature()) {
      // Ignore
    } else {
      throw new AnalysisError(`Unknown class element`);
    }
  }

  // 2nd pass: look for uses within items
  function traverseItem(path: NodePath) {
    traverseThis(path, (thisPath) => {
      // Ensure this is part of `this.foo`
      const thisMemberPath = thisPath.parentPath;
      if (!thisMemberPath.isMemberExpression({
        object: thisPath.node
      })) {
        throw new AnalysisError(`Stray this`);
      }

      const name = memberRefName(thisMemberPath.node);
      if (name == null) {
        throw new AnalysisError(`Unrecognized this-property reference`);
      }

      if (!fields.has(name)) {
        fields.set(name, []);
      }
      const field = fields.get(name)!;

      const thisMemberParentPath = thisMemberPath.parentPath;
      const hasWrite =
        // `this.foo = 0;` (incl. operator assignment)
        thisMemberParentPath.isAssignmentExpression({
          left: thisMemberPath.node,
        })
        // `delete this.foo;`
        || thisMemberParentPath.isUnaryExpression({
          operator: "delete",
          argument: thisMemberPath.node,
        })

      field.push({
        type: "expr",
        path: thisMemberPath,
        hasType: undefined,
        hasInit: undefined,
        hasWrite,
        hasSideEffect: undefined
      });
    });
  }
  for (const itemPath of path.get("body").get("body")) {
    if (
      itemPath.isClassProperty()
      || itemPath.isClassPrivateProperty()
      || itemPath.isClassMethod()
      || itemPath.isClassPrivateMethod()
      || isClassAccessorProperty(itemPath)
      || itemPath.isTSDeclareMethod()
    ) {
      if (itemPath.node.static) {
        throw new AnalysisError(`Not implemented yet: static`);
      }
      if (itemPath.isClassProperty() || itemPath.isClassPrivateProperty()) {
        const itemPath_: NodePath<ClassProperty | ClassPrivateProperty> = itemPath;
        const valuePath = itemPath_.get("value");
        if (valuePath.isExpression()) {
          traverseItem(valuePath);
        }
      } else if (itemPath.isClassMethod() || itemPath.isClassPrivateMethod()) {
        const itemPath_: NodePath<ClassMethod | ClassPrivateMethod > = itemPath;
        const kind = itemPath.node.kind ?? "method";
        if (kind === "method") {
          for (const paramPath of itemPath_.get("params")) {
            traverseItem(paramPath);
          }
          traverseItem(itemPath_.get("body"));
        } else if (kind === "get" || kind === "set") {
          throw new AnalysisError(`Not implemented yet: getter / setter`);
        } else if (kind === "constructor") {
          throw new AnalysisError(`Not implemented yet: constructor`);
        } else {
          throw new AnalysisError(`Not implemented yet: ${kind}`);
        }
      } else if (itemPath.isTSDeclareMethod()) {
        // skip
      } else if (isClassAccessorProperty(itemPath)) {
        throw new AnalysisError(`Not implemented yet: class accessor property`);
      }
    } else if (isStaticBlock(itemPath)) {
      throw new AnalysisError(`Not implemented yet: static block`);
    } else if (itemPath.isTSIndexSignature()) {
      // Ignore
    } else {
      throw new AnalysisError(`Unknown class element`);
    }
  }

  for (const [name, fieldSites] of fields.entries()) {
    const numInits = fieldSites.reduce((n, site) => n + Number(!!site.hasInit), 0);
    if (numInits > 1) {
      throw new AnalysisError(`${name} is initialized more than once`);
    }
    const numTypes = fieldSites.reduce((n, site) => n + Number(!!site.hasType), 0);
    if (numTypes > 1) {
      throw new AnalysisError(`${name} is declared more than once`);
    }
  }

  return fields;
}

function traverseThis(path: NodePath, visit: (path: NodePath<ThisExpression>) => void) {
  path.traverse({
    ThisExpression: visit,
    FunctionDeclaration(path) {
      path.skip();
    },
    FunctionExpression(path) {
      path.skip();
    },
    ClassDeclaration(path) {
      path.skip();
    },
    ClassExpression(path) {
      path.skip();
    },
    ObjectMethod(path) {
      path.skip();
    },
  });
}

function estimateSideEffect(expr: Expression): boolean {
  switch (expr.type) {
    case "NullLiteral":
    case "BooleanLiteral":
    case "NumericLiteral":
    case "BigIntLiteral":
    case "Identifier":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return false;

    case "MemberExpression":
      // Assume `foo.bar` to be pure
      return estimateSideEffect(expr.object) || (expr.property.type !== "PrivateName" && estimateSideEffect(expr.property));
    
    case "UnaryExpression":
      switch (expr.operator) {
        case "void":
        case "!":
        case "+":
        case "-":
        case "~":
        case "typeof":
          return estimateSideEffect(expr.argument);
      }
      break;
    case "BinaryExpression":
      if (expr.left.type === "PrivateName") {
        return estimateSideEffect(expr.right);
      } else {
        return estimateSideEffect(expr.left) || estimateSideEffect(expr.right);
      }
    case "SequenceExpression":
      return expr.expressions.some((elem) => estimateSideEffect(elem));
    case "ArrayExpression":
      return expr.elements.some((elem) =>
        elem == null
        ? false
        : elem.type === "SpreadElement"
        ? estimateSideEffect(elem.argument)
        : estimateSideEffect(elem)
      );
    case "ObjectExpression":
      return expr.properties.some((elem) =>
        elem.type === "SpreadElement"
        ? estimateSideEffect(elem.argument)
        : elem.type === "ObjectMethod"
        ? estimateSideEffect(elem.key)
        : elem.key.type === "PrivateName"
          ? estimateSideEffect(elem.value as Expression)
          : estimateSideEffect(elem.key) && estimateSideEffect(elem.value as Expression)
      );
  }
  return true;
}
