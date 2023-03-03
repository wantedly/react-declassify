import type { ArrowFunctionExpression, Expression, Identifier, ImportDeclaration, MemberExpression, Pattern, RestElement, Statement, TSEntityName, TSType } from "@babel/types";
import type { NodePath, PluginObj, PluginPass } from "@babel/core";
import { assignTypeAnnotation, importName, isTS } from "./utils.js";
import { AnalysisError, analyzeBody, analyzeHead, ComponentBody, ComponentHead, needsProps, RefInfo } from "./analysis.js";

type Options = {};

export default function plugin(babel: typeof import("@babel/core")): PluginObj<PluginPass & { opts: Options }> {
  const { types: t } = babel;
  return {
    name: "react-declassify",
    visitor: {
      ClassDeclaration(path, state) {
        const ts = isTS(state);
        const head = analyzeHead(path);
        if (!head) {
          return;
        }
        if (path.parentPath.isExportDefaultDeclaration()) {
          const declPath = path.parentPath;
          try {
            const body = analyzeBody(path, babel);
            const { funcNode, typeNode } = transformClass(head, body, { ts }, babel);
            if (path.node.id) {
              declPath.replaceWithMultiple([
                t.variableDeclaration("const", [
                  t.variableDeclarator(
                    ts
                    ? assignTypeAnnotation(
                      t.cloneNode(path.node.id),
                      t.tsTypeAnnotation(typeNode!),
                    )
                    : t.cloneNode(path.node.id),
                    funcNode,
                  )
                ]),
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
            t.addComment(declPath.node, "leading", ` react-declassify:disabled Cannot perform transformation: ${e.message} `);
            refreshComments(declPath.node);
          }
        } else {
          try {
            const body = analyzeBody(path, babel);
            const { funcNode, typeNode } = transformClass(head, body, { ts }, babel);
            path.replaceWith(t.variableDeclaration("const", [
              t.variableDeclarator(
                ts
                ? assignTypeAnnotation(
                  t.cloneNode(path.node.id),
                  t.tsTypeAnnotation(typeNode!),
                )
                : t.cloneNode(path.node.id),
                funcNode,
              )
            ]));
          } catch (e) {
            if (!(e instanceof AnalysisError)) {
              throw e;
            }
            t.addComment(path.node, "leading", ` react-declassify:disabled Cannot perform transformation: ${e.message} `);
            refreshComments(path.node);
          }
        }
      },
    },
  };
}

type TransformResult = {
  funcNode: ArrowFunctionExpression;
  typeNode?: TSType | undefined;
};

function transformClass(head: ComponentHead, body: ComponentBody, options: { ts: boolean }, babel: typeof import("@babel/core")): TransformResult {
  const { types: t } = babel;
  const { ts } = options;

  for (const pv of body.propVars) {
    if (pv.oldName !== pv.newName) {
      // Rename variables that props are bound to.
      // E.g. `foo` as in `const { foo } = this.props`.
      // This is to ensure we hoist them correctly.
      pv.scope.rename(pv.oldName, pv.newName);
    }
  }
  for (const pb of body.propBinders) {
    // Remove assignments of this.props.
    // We re-add them later to achieve hoisting.
    pb.path.remove();
  }
  for (const ren of body.render.renames) {
    // Rename local variables in the render method
    // to avoid unintentional variable capturing.
    ren.scope.rename(ren.oldName, ren.newName);
  }
  for (const tr of body.thisRefs) {
    if (tr.kind === "props") {
      // this.props -> props
      tr.path.replaceWith(tr.path.node.property);
    } else if (tr.kind === "state") {
      // this.state.foo -> foo
      tr.path.replaceWith(t.identifier(tr.field.localName));
    } else if (tr.kind === "setState") {
      // this.setState({ foo: 1 }) -> setFoo(1)
      tr.path.replaceWith(
        t.callExpression(
          t.identifier(tr.field.localSetterName),
          [tr.rhs.node]
        )
      );
    } else if (tr.kind === "userDefined") {
      // this.foo -> foo
      tr.path.replaceWith(tr.path.node.property);
    }
  }
  // Preamble is a set of statements to be added before the original render body.
  const preamble: Statement[] = [];
  if (body.propVarNames.size > 0) {
    // Expand this.props into variables.
    // E.g. const { foo, bar } = props;
    preamble.push(t.variableDeclaration("const", [
      t.variableDeclarator(
        t.objectPattern(Array.from(body.propVarNames.entries()).map(([propName, localName]) =>
          t.objectProperty(
            t.identifier(propName),
            t.identifier(localName),
            false,
            propName === localName,
          ),
        )),
        t.identifier("props"),
      ),
    ]));
  }
  for (const field of body.state.values()) {
    // State declarations
    preamble.push(t.variableDeclaration("const", [
      t.variableDeclarator(
        t.arrayPattern([
          t.identifier(field.localName),
          t.identifier(field.localSetterName),
        ]),
        t.callExpression(
          getReactImport("useState", babel, head.superClassRef),
          field.init ? [field.init.node] : []
        )
      )
    ]))
  }
  for (const [, mem] of body.members.entries()) {
    // Method definitions.
    const methNode = mem.path.node;
    preamble.push(t.functionDeclaration(
      methNode.key as Identifier,
      methNode.params as (Identifier | RestElement | Pattern)[],
      methNode.body,
    ));
  }
  const bodyNode = body.render.path.node.body;
  bodyNode.body.splice(0, 0, ...preamble);
  return {
    funcNode: t.arrowFunctionExpression(
      needsProps(body) ? [t.identifier("props")] : [],
      bodyNode
    ),
    typeNode: ts
      ? t.tsTypeReference(
        toTSEntity(getReactImport("FC", babel, head.superClassRef), babel),
        head.props
        ? t.tsTypeParameterInstantiation([head.props.node])
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
  superClassRef: RefInfo
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
