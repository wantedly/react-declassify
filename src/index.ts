import type { Identifier, Pattern, RestElement, Statement } from "@babel/types";
import type { PluginObj, PluginPass } from "@babel/core";
import { assignTypeAnnotation, isTS } from "./utils.js";
import { AnalysisError, analyzeBody, analyzeHead, needsProps } from "./analysis.js";

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
        try {
          const body = analyzeBody(path, babel);
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
            } else if (tr.kind === "userDefined") {
              // this.foo -> foo
              tr.path.replaceWith(tr.path.node.property);
            }
          }
          // Preamble is a set of statements to be added before the original render body.
          const preamble: Statement[] = [];
          if (body.propVarNames.size > 0) {
            // Expand this.props into variables.
            // E.g. const { foo, bar } = this.props;
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
                // this.props
                t.memberExpression(t.thisExpression(), t.identifier("props")),
              ),
            ]));
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
          path.replaceWith(t.variableDeclaration("const", [
            t.variableDeclarator(
              ts
              ? assignTypeAnnotation(
                t.cloneNode(path.node.id),
                t.tsTypeAnnotation(
                  t.tsTypeReference(
                    t.tsQualifiedName(
                      t.identifier("React"),
                      t.identifier("FC"),
                    ),
                    head.props
                    ? t.tsTypeParameterInstantiation([head.props.node])
                    : null
                  ),
                ),
              )
              : t.cloneNode(path.node.id),
              t.arrowFunctionExpression(
                needsProps(body) ? [t.identifier("props")] : [],
                bodyNode
              ),
            )
          ]));
        } catch (e) {
          if (!(e instanceof AnalysisError)) {
            throw e;
          }
          t.addComment(path.node, "leading", ` react-declassify:disabled Cannot perform transformation: ${e.message} `);
          refreshComments(path.node);
        }
      },
    },
  };
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
