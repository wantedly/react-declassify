import type { ArrowFunctionExpression, ClassMethod, ClassPrivateMethod, Expression, FunctionDeclaration, FunctionExpression, Identifier, ImportDeclaration, MemberExpression, ObjectMethod, Pattern, RestElement, Statement, TSEntityName, TSType, TSTypeAnnotation, TSTypeParameterDeclaration, VariableDeclaration } from "@babel/types";
import type { NodePath, PluginObj, PluginPass } from "@babel/core";
import { assignReturnType, assignTypeAnnotation, assignTypeArguments, assignTypeParameters, importName, isTS, nonNullPath } from "./utils.js";
import { AnalysisError, analyzeClass, preanalyzeClass, AnalysisResult, PreAnalysisResult, needsProps, LibRef } from "./analysis.js";

type Options = {};

export default function plugin(babel: typeof import("@babel/core")): PluginObj<PluginPass & { opts: Options }> {
  const { types: t } = babel;
  return {
    name: "react-declassify",
    visitor: {
      ClassDeclaration(path, state) {
        const ts = isTS(state);
        const preanalysis = preanalyzeClass(path);
        if (!preanalysis) {
          return;
        }
        if (path.parentPath.isExportDefaultDeclaration()) {
          const declPath = path.parentPath;
          try {
            const analysis = analyzeClass(path, preanalysis);
            const { funcNode, typeNode } = transformClass(preanalysis, analysis, { ts }, babel);
            if (path.node.id) {
              // Necessary to avoid false error regarding duplicate declaration.
              path.scope.removeBinding(path.node.id.name);
              declPath.replaceWithMultiple([
                constDeclaration(
                  babel,
                  t.cloneNode(path.node.id),
                  funcNode,
                  typeNode ? t.tsTypeAnnotation(typeNode) : undefined
                ),
                t.exportDefaultDeclaration(
                  t.cloneNode(path.node.id)
                )
              ]);
            } else {
              path.replaceWith(funcNode);
            }
          } catch (e) {
            if (!(e instanceof AnalysisError)) {
              throw e;
            }
            t.addComment(declPath.node, "leading", ` react-declassify-disable Cannot perform transformation: ${e.message} `);
            refreshComments(declPath.node);
          }
        } else {
          try {
            const analysis = analyzeClass(path, preanalysis);
            const { funcNode, typeNode } = transformClass(preanalysis, analysis, { ts }, babel);
            // Necessary to avoid false error regarding duplicate declaration.
            path.scope.removeBinding(path.node.id.name);
            path.replaceWith(
              constDeclaration(
                babel,
                t.cloneNode(path.node.id),
                funcNode,
                typeNode ? t.tsTypeAnnotation(typeNode) : undefined
              )
            );
          } catch (e) {
            if (!(e instanceof AnalysisError)) {
              throw e;
            }
            t.addComment(path.node, "leading", ` react-declassify-disable Cannot perform transformation: ${e.message} `);
            refreshComments(path.node);
          }
        }
      },
    },
  };
}

type TransformResult = {
  funcNode: Expression;
  typeNode?: TSType | undefined;
};

function transformClass(preanalysis: PreAnalysisResult, analysis: AnalysisResult, options: { ts: boolean }, babel: typeof import("@babel/core")): TransformResult {
  const { types: t } = babel;
  const { ts } = options;

  for (const [, prop] of analysis.props.props) {
    for (const alias of prop.aliases) {
      if (alias.localName !== prop.newAliasName!) {
        // Rename variables that props are bound to.
        // E.g. `foo` as in `const { foo } = this.props`.
        // This is to ensure we hoist them correctly.
        alias.scope.rename(alias.localName, prop.newAliasName!);
      }
    }
  }
  for (const path of analysis.locals.removePaths) {
    path.remove();
  }
  for (const ren of analysis.render.renames) {
    // Rename local variables in the render method
    // to avoid unintentional variable capturing.
    ren.scope.rename(ren.oldName, ren.newName);
  }
  if (analysis.props.hasDefaults) {
    for (const [, prop] of analysis.props.props) {
      for (const site of prop.sites) {
        // this.props.foo -> foo
        site.path.replaceWith(t.identifier(prop.newAliasName!));
      }
    }
  } else {
    for (const site of analysis.props.sites) {
      // this.props -> props
      site.path.replaceWith(site.path.node.property);
    }
  }
  for (const [, prop] of analysis.props.props) {
    if (prop.defaultValue && prop.typing) {
      // Make the prop optional
      prop.typing.node.optional = true;
      if (prop.typing.isTSPropertySignature()) {
        const typeAnnotation = nonNullPath(prop.typing.get("typeAnnotation"))?.get("typeAnnotation");
        if (typeAnnotation) {
          if (typeAnnotation.isTSUnionType()) {
            if (typeAnnotation.node.types.some((t) => t.type === "TSUndefinedKeyword")) {
              // No need to add undefined
            } else {
              typeAnnotation.node.types.push(t.tsUndefinedKeyword());
            }
          } else {
            typeAnnotation.replaceWith(t.tsUnionType([
              typeAnnotation.node,
              t.tsUndefinedKeyword(),
            ]))
          }
        }
      }
      if (
        prop.typing.node.type === "TSPropertySignature"
        && prop.typing.node.typeAnnotation
      ) {
        const typeAnnot = prop.typing.node.typeAnnotation
      }
    }
  }
  for (const [name, stateAnalysis] of analysis.state) {
    for (const site of stateAnalysis.sites) {
      if (site.type === "expr") {
        // this.state.foo -> foo
        site.path.replaceWith(t.identifier(stateAnalysis.localName!));
      } else if (site.type === "setState") {
        // this.setState({ foo: 1 }) -> setFoo(1)
        site.path.replaceWith(
          t.callExpression(
            t.identifier(stateAnalysis.localSetterName!),
            [site.valuePath.node]
          )
        );
      }
    }
  }
  for (const [, field] of analysis.userDefined.fields) {
    if (field.type === "user_defined_function" || field.type === "user_defined_ref") {
      for (const site of field.sites) {
        if (site.type === "expr") {
          // this.foo -> foo
          site.path.replaceWith(t.identifier(field.localName!));
        }
      }
    } else if (field.type === "user_defined_direct_ref") {
      for (const site of field.sites) {
        if (site.type === "expr") {
          // this.foo -> foo.current
          site.path.replaceWith(
            t.memberExpression(
              t.identifier(field.localName!),
              t.identifier("current")
            )
          );
        }
      }
    }
  }
  // Preamble is a set of statements to be added before the original render body.
  const preamble: Statement[] = [];
  const propsWithAlias = Array.from(analysis.props.props).filter(([, prop]) => prop.needsAlias);
  if (propsWithAlias.length > 0) {
    // Expand this.props into variables.
    // E.g. const { foo, bar } = props;
    preamble.push(t.variableDeclaration("const", [
      t.variableDeclarator(
        t.objectPattern(propsWithAlias.map(([name, prop]) =>
          t.objectProperty(
            t.identifier(name),
            prop.defaultValue
            ? t.assignmentPattern(
              t.identifier(prop.newAliasName!),
              prop.defaultValue.node
            )
            : t.identifier(prop.newAliasName!),
            false,
            name === prop.newAliasName!,
          ),
        )),
        t.identifier("props"),
      ),
    ]));
  }
  for (const field of analysis.state.values()) {
    // State declarations
    const call = t.callExpression(
      getReactImport("useState", babel, preanalysis.superClassRef),
      field.init ? [field.init.valuePath.node] : []
    );
    preamble.push(t.variableDeclaration("const", [
      t.variableDeclarator(
        t.arrayPattern([
          t.identifier(field.localName!),
          t.identifier(field.localSetterName!),
        ]),
        ts && field.typeAnnotation ?
          assignTypeArguments(
            call,
            t.tsTypeParameterInstantiation([
              field.typeAnnotation.type === "method"
              ? t.tsFunctionType(
                  undefined,
                  field.typeAnnotation.params.map((p) => p.node),
                  t.tsTypeAnnotation(field.typeAnnotation.returnType.node)
                )
              : field.typeAnnotation.path.node
            ])
          )
        : call
      )
    ]))
  }
  for (const [, field] of analysis.userDefined.fields) {
    if (field.type === "user_defined_function") {
      // Method definitions.
      if (field.init.type === "method") {
        const methNode = field.init.path.node;
        preamble.push(functionDeclarationFrom(babel, methNode, t.identifier(field.localName!)));
      } else {
        const methNode = field.init.initPath.node;
        if (
          methNode.type === "FunctionExpression"
          && !field.typeAnnotation
        ) {
          preamble.push(functionDeclarationFrom(babel, methNode, t.identifier(field.localName!)));
        } else {
          const expr =
            methNode.type === "FunctionExpression"
            ? functionExpressionFrom(babel, methNode)
            : arrowFunctionExpressionFrom(babel, methNode);
          preamble.push(t.variableDeclaration(
            "const",
            [t.variableDeclarator(
              assignTypeAnnotation(
                t.identifier(field.localName!),
                field.typeAnnotation ? t.tsTypeAnnotation(field.typeAnnotation.node) : undefined
              ),
              expr
            )]
          ));
        }
      }
    } else if (field.type === "user_defined_ref") {
      // const foo = useRef(null);
      const call = t.callExpression(
        getReactImport("useRef", babel, preanalysis.superClassRef),
        [t.nullLiteral()]
      );
      preamble.push(t.variableDeclaration(
        "const",
        [t.variableDeclarator(
          t.identifier(field.localName!),
          ts && field.typeAnnotation
            ? assignTypeArguments(
              call,
              t.tsTypeParameterInstantiation([
                field.typeAnnotation.node
              ])
            )
            : call
        )]
      ))
    } else if (field.type === "user_defined_direct_ref") {
      // const foo = useRef(init);
      const call = t.callExpression(
        getReactImport("useRef", babel, preanalysis.superClassRef),
        [field.init.node]
      );
      preamble.push(t.variableDeclaration(
        "const",
        [t.variableDeclarator(
          t.identifier(field.localName!),
          ts && field.typeAnnotation
            ? assignTypeArguments(
              call,
              t.tsTypeParameterInstantiation([
                field.typeAnnotation.node
              ])
            )
            : call
        )]
      ))
    }
  }
  const bodyNode = analysis.render.path.node.body;
  bodyNode.body.splice(0, 0, ...preamble);
  // recast is not smart enough to correctly pretty-print type parameters for arrow functions.
  // so we fall back to functions when type parameters are present.
  const functionNeeded = preanalysis.isPure || !!preanalysis.typeParameters;
  const params = needsProps(analysis)
    ? [assignTypeAnnotation(
        t.identifier("props"),
        // If the function is generic, put type annotations here instead of the `const` to be defined.
        // TODO: take children into account, while being careful about difference between `@types/react` v17 and v18
        preanalysis.typeParameters
        ? preanalysis.props
          ? t.tsTypeAnnotation(preanalysis.props.node)
          : undefined
        : undefined
      )]
    : [];
  // If the function is generic, put type annotations here instead of the `const` to be defined.
  const returnType = preanalysis.typeParameters
      // Construct `React.ReactElement | null`
    ? t.tsTypeAnnotation(
        t.tsUnionType([
          t.tsTypeReference(
            toTSEntity(getReactImport("ReactElement", babel, preanalysis.superClassRef), babel)
          ),
          t.tsNullKeyword(),
        ])
      )
    : undefined;
  const funcNode = assignTypeParameters(
    assignReturnType(
      functionNeeded
        ? t.functionExpression(
          preanalysis.name ? t.cloneNode(preanalysis.name) : undefined,
          params,
          bodyNode
        )
        : t.arrowFunctionExpression(
          params,
          bodyNode
        ),
      returnType
    ),
    preanalysis.typeParameters?.node
  );
  return {
    funcNode: preanalysis.isPure
      ? t.callExpression(
          getReactImport("memo", babel, preanalysis.superClassRef),
          [funcNode]
        )
      : funcNode,
    typeNode: ts && !preanalysis.typeParameters
      ? t.tsTypeReference(
        toTSEntity(getReactImport("FC", babel, preanalysis.superClassRef), babel),
        preanalysis.props
        ? t.tsTypeParameterInstantiation([preanalysis.props.node])
        : null
      )
      : undefined,
  };
}

function toTSEntity(
  expr: Expression,
  babel: typeof import("@babel/core"),
): TSEntityName {
  const { types: t } = babel;
  if (expr.type === "MemberExpression" && !expr.computed && expr.property.type === "Identifier") {
    return t.tsQualifiedName(toTSEntity(expr.object, babel), t.cloneNode(expr.property));
  } else if (expr.type === "Identifier") {
    return t.cloneNode(expr);
  }
  throw new Error(`Cannot convert to TSEntityName: ${expr.type}`);
}

function getReactImport(
  name: string,
  babel: typeof import("@babel/core"),
  superClassRef: LibRef
): MemberExpression | Identifier {
  const { types: t } = babel;
  if (superClassRef.type === "global") {
    return t.memberExpression(
      t.identifier(superClassRef.globalName),
      t.identifier(name),
    );
  }
  if (superClassRef.kind === "ns") {
    return t.memberExpression(
      t.identifier(superClassRef.specPath.node.local.name),
      t.identifier(name),
    );
  }
  const decl = superClassRef.specPath.parentPath as NodePath<ImportDeclaration>;
  for (const spec of decl.get("specifiers")) {
    if (spec.isImportSpecifier() && importName(spec.node.imported) === name) {
      return t.cloneNode(spec.node.local);
    }
  }
  // No existing decl
  const newName = decl.scope.getBinding(name) ? decl.scope.generateUid(name) : name;
  const local = t.identifier(newName);
  decl.get("specifiers")[decl.node.specifiers.length - 1]!.insertAfter(
    t.importSpecifier(
      local,
      name === newName ? local : t.identifier(newName)
    )
  );
  return t.identifier(newName);
}

type FunctionLike = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression | ClassMethod | ClassPrivateMethod | ObjectMethod;

function functionName(node: FunctionLike): Identifier | undefined {
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
      return node.id ?? undefined;
  }
}

function functionDeclarationFrom(
  babel: typeof import("@babel/core"),
  node: FunctionLike,
  name?: Identifier | null
) {
  const { types: t } = babel;
  return assignTypeParameters(
    assignReturnType(
      t.functionDeclaration(
        name ?? functionName(node),
        node.params as (Identifier | RestElement | Pattern)[],
        node.body.type === "BlockStatement"
        ? node.body
        : t.blockStatement([
            t.returnStatement(node.body)
          ]),
        node.generator,
        node.async,
      ),
      node.returnType
    ),
    node.typeParameters as TSTypeParameterDeclaration | null | undefined
  );
}

function functionExpressionFrom(
  babel: typeof import("@babel/core"),
  node: FunctionLike,
  name?: Identifier | null
) {
  const { types: t } = babel;
  return assignTypeParameters(
    assignReturnType(
      t.functionExpression(
        name ?? functionName(node),
        node.params as (Identifier | RestElement | Pattern)[],
        node.body.type === "BlockStatement"
        ? node.body
        : t.blockStatement([
            t.returnStatement(node.body)
          ]),
        node.generator,
        node.async,
      ),
      node.returnType
    ),
    node.typeParameters as TSTypeParameterDeclaration | null | undefined
  );
}

function arrowFunctionExpressionFrom(
  babel: typeof import("@babel/core"),
  node: FunctionLike
) {
  const { types: t } = babel;
  return assignTypeParameters(
    assignReturnType(
      t.arrowFunctionExpression(
        node.params as (Identifier | RestElement | Pattern)[],
        node.body,
        node.async,
      ),
      node.returnType
    ),
    node.typeParameters as TSTypeParameterDeclaration | null | undefined
  );
}

function constDeclaration(
  babel: typeof import("@babel/core"),
  id: Identifier,
  init: Expression,
  typeAnnotation?: TSTypeAnnotation,
): VariableDeclaration | FunctionDeclaration {
  const { types: t } = babel;
  if (
    init.type === "FunctionExpression"
    && (!init.id || init.id.name === id.name)
    && !typeAnnotation
  ) {
    return functionDeclarationFrom(babel, init, id);
  }
  return t.variableDeclaration(
    "const",
    [t.variableDeclarator(
      assignTypeAnnotation(id, typeAnnotation),
      init
    )]
  );
}

/**
 * Refreshes recast's internal state to force generically printing comments.
 */
function refreshComments(node: any) {
  for (const comment of node.leadingComments ?? []) {
    comment.leading ??= true;
    comment.trailing ??= false;
  }
  for (const comment of node.trailingComments ?? []) {
    comment.leading ??= false;
    comment.trailing ??= true;
  }
  node.comments = [
    ...node.leadingComments ?? [],
    ...node.innerComments ?? [],
    ...node.trailingComments ?? [],
  ];
  node.original = undefined;
}
