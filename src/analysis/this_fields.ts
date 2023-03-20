import type { NodePath } from "@babel/core";
import type { AssignmentExpression, CallExpression, ClassAccessorProperty, ClassDeclaration, ClassMethod, ClassPrivateMethod, ClassPrivateProperty, ClassProperty, Expression, ExpressionStatement, MemberExpression, ThisExpression, TSDeclareMethod } from "@babel/types";
import { getOr, isClassAccessorProperty, isClassMethodLike, isClassMethodOrDecl, isClassPropertyLike, isNamedClassElement, isStaticBlock, memberName, memberRefName, nonNullPath } from "../utils.js";
import { AnalysisError } from "./error.js";

export type ThisFields = {
  thisFields: Map<string, ThisFieldSite[]>;
  staticFields: Map<string, StaticFieldSite[]>;
};

export type ThisFieldSite = {
  type: "class_field";
  path: NodePath<ClassProperty | ClassPrivateProperty | ClassMethod | ClassPrivateMethod | ClassAccessorProperty | TSDeclareMethod | AssignmentExpression>;
  hasType: boolean;
  init: FieldInit | undefined;
  hasWrite: undefined;
  hasSideEffect: boolean;
} | {
  type: "expr";
  path: NodePath<MemberExpression>;
  hasType: undefined;
  init: undefined;
  hasWrite: boolean;
  hasSideEffect: undefined;
};

export type FieldInit = {
  type: "init_value";
  valuePath: NodePath<Expression>
} | {
  type: "init_method";
  methodPath: NodePath<ClassMethod | ClassPrivateMethod>;
};

export type StaticFieldSite = {
  type: "class_field";
  path: NodePath<ClassProperty | ClassPrivateProperty | ClassMethod | ClassPrivateMethod | ClassAccessorProperty | TSDeclareMethod | AssignmentExpression>;
  hasType: boolean;
  init: FieldInit | undefined;
  hasWrite: undefined;
  hasSideEffect: boolean;
};

export function analyzeThisFields(path: NodePath<ClassDeclaration>): ThisFields {
  const thisFields = new Map<string, ThisFieldSite[]>();
  const getThisField = (name: string) => getOr(thisFields, name, () => []);
  const staticFields = new Map<string, StaticFieldSite[]>();
  const getStaticField = (name: string) => getOr(staticFields, name, () => []);
  let constructor: NodePath<ClassMethod> | undefined = undefined;
  const bodies: NodePath[] = [];
  // 1st pass: look for class field definitions
  for (const itemPath of path.get("body").get("body")) {
    if (isNamedClassElement(itemPath)) {
      const isStatic = itemPath.node.static;
      const name = memberName(itemPath.node);
      if (name == null) {
        throw new AnalysisError(`Unnamed class element`);
      }
      const field = isStatic ? getStaticField(name) : getThisField(name);
      if (isClassPropertyLike(itemPath)) {
        const valuePath = nonNullPath<Expression>(itemPath.get("value"));
        field.push({
          type: "class_field",
          path: itemPath,
          hasType: !!itemPath.node.typeAnnotation,
          init: valuePath ?  { type: "init_value", valuePath } : undefined,
          hasWrite: undefined,
          hasSideEffect: !!itemPath.node.value && estimateSideEffect(itemPath.node.value),
        });
        if (valuePath) {
          bodies.push(valuePath);
        }
      } else if (isClassMethodOrDecl(itemPath)) {
        const kind = itemPath.node.kind ?? "method";
        if (kind === "method") {
          field.push({
            type: "class_field",
            path: itemPath,
            hasType: itemPath.isTSDeclareMethod(),
            init: isClassMethodLike(itemPath)
              ? { type: "init_method", methodPath: itemPath }
              : undefined,
            hasWrite: undefined,
            hasSideEffect: false,
          });
          if (isClassMethodLike(itemPath)) {
            for (const paramPath of itemPath.get("params")) {
               bodies.push(paramPath);
            }
            bodies.push(itemPath.get("body"));
          }
        } else if (kind === "get" || kind === "set") {
          throw new AnalysisError(`Not implemented yet: getter / setter`);
        } else if (kind === "constructor") {
          if (isStatic) {
            throw new Error("static constructor found");
          }
          constructor = itemPath as NodePath<ClassMethod>;
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

  // 1st pass additional work: field initialization in constructor
  if (constructor) {
    if (constructor.node.params.length > 1) {
      throw new AnalysisError(`Constructor has too many parameters`);
    } else if (constructor.node.params.length < 1) {
      throw new AnalysisError(`Constructor has too few parameters`);
    }
    const param = constructor.node.params[0]!;
    if (param.type !== "Identifier") {
      throw new AnalysisError(`Invalid constructor parameters`);
    }

    const stmts = constructor.get("body").get("body");

    // Check super() call
    const superCallIndex = stmts.findIndex((stmt) =>
      stmt.node.type === "ExpressionStatement"
      && stmt.node.expression.type === "CallExpression"
      && stmt.node.expression.callee.type === "Super"
    );
    if (superCallIndex === -1) {
      throw new AnalysisError(`No super call`);
    } else if (superCallIndex > 0) {
      throw new AnalysisError(`No immediate super call`);
    }
    const superCall = stmts[superCallIndex]!;
    const superCallArgs =
      ((superCall.node as ExpressionStatement).expression as CallExpression).arguments;
    if (superCallArgs.length > 1) {
      throw new AnalysisError(`Too many arguments for super()`);
    } else if (superCallArgs.length < 1) {
      throw new AnalysisError(`Too few arguments for super()`);
    }
    const superCallArg = superCallArgs[0]!;
    if (superCallArg.type !== "Identifier" || superCallArg.name !== param.name) {
      throw new AnalysisError(`Invalid argument for super()`);
    }

    const initStmts = stmts.slice(superCallIndex + 1);
    for (const stmt of initStmts) {
      if (!(
        stmt.node.type === "ExpressionStatement"
        && stmt.node.expression.type === "AssignmentExpression"
        && stmt.node.expression.operator === "="
        && stmt.node.expression.left.type === "MemberExpression"
        && stmt.node.expression.left.object.type === "ThisExpression"
      )) {
        throw new AnalysisError(`Non-analyzable initialization in constructor`);
      }
      const exprPath = (stmt as NodePath<ExpressionStatement>).get("expression") as NodePath<AssignmentExpression>;
      const name = memberRefName(stmt.node.expression.left);
      if (name == null) {
        throw new AnalysisError(`Non-analyzable initialization in constructor`);
      }
      // TODO: check for parameter/local variable reference

      const field = getThisField(name)!;
      field.push({
        type: "class_field",
        path: exprPath,
        hasType: false,
        init: {
          type: "init_value",
          valuePath: exprPath.get("right"),
        },
        hasWrite: undefined,
        hasSideEffect: estimateSideEffect(stmt.node.expression.right),
      });
      bodies.push(exprPath.get("right"));
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

      const field = getThisField(name)!;

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
        init: undefined,
        hasWrite,
        hasSideEffect: undefined
      });
    });
  }
  for (const body of bodies) {
    traverseItem(body);
  }

  for (const [name, fieldSites] of thisFields) {
    if (fieldSites.length === 0) {
      thisFields.delete(name);
    }
    const numInits = fieldSites.reduce((n, site) => n + Number(!!site.init), 0);
    if (numInits > 1) {
      throw new AnalysisError(`${name} is initialized more than once`);
    }
    const numTypes = fieldSites.reduce((n, site) => n + Number(!!site.hasType), 0);
    if (numTypes > 1) {
      throw new AnalysisError(`${name} is declared more than once`);
    }
  }
  for (const [name, fieldSites] of staticFields) {
    if (fieldSites.length === 0) {
      thisFields.delete(name);
    }
    const numInits = fieldSites.reduce((n, site) => n + Number(!!site.init), 0);
    if (numInits > 1) {
      throw new AnalysisError(`static ${name} is initialized more than once`);
    }
    const numTypes = fieldSites.reduce((n, site) => n + Number(!!site.hasType), 0);
    if (numTypes > 1) {
      throw new AnalysisError(`static ${name} is declared more than once`);
    }
  }

  return { thisFields, staticFields };
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
