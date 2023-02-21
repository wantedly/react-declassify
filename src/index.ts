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
          const body = analyzeBody(path);
          for (const tr of body.render.thisRefs) {
            if (tr.kind === "props") {
              // this.props -> props
              tr.path.replaceWith(tr.path.node.property);
            }
          }
          const preamble: Statement[] = [];
          for (const [, mem] of body.members.entries()) {
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
