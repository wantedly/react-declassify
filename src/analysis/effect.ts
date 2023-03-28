import type { ClassMethod } from "@babel/types";
import type { NodePath } from "@babel/traverse";
import type { ClassFieldAnalysis } from "./class_fields.js";
import { AnalysisError } from "./error.js";
import type { UserDefinedAnalysis } from "./user_defined.js";

export type EffectAnalysis = {
  cdmPath: NodePath<ClassMethod> | undefined;
  cduPath: NodePath<ClassMethod> | undefined;
  cwuPath: NodePath<ClassMethod> | undefined;
  isMountedLocalName?: string | undefined;
  cleanupLocalName?: string | undefined;
};
export function analyzeEffects(
  componentDidMount: ClassFieldAnalysis,
  componentDidUpdate: ClassFieldAnalysis,
  componentWillUnmount: ClassFieldAnalysis,
  userDefined: UserDefinedAnalysis,
): EffectAnalysis {
  const cdmInit = componentDidMount.sites.find((site) => site.init);
  const cduInit = componentDidUpdate.sites.find((site) => site.init);
  const cwuInit = componentWillUnmount.sites.find((site) => site.init);
  if (componentDidMount.sites.some((site) => !site.init)) {
    throw new AnalysisError("Do not use componentDidMount by yourself");
  }
  if (componentDidUpdate.sites.some((site) => !site.init)) {
    throw new AnalysisError("Do not use componentDidUpdate by yourself");
  }
  if (componentWillUnmount.sites.some((site) => !site.init)) {
    throw new AnalysisError("Do not use componentWillUnmount by yourself");
  }
  let cdmPath: NodePath<ClassMethod> | undefined = undefined;
  let cduPath: NodePath<ClassMethod> | undefined = undefined;
  let cwuPath: NodePath<ClassMethod> | undefined = undefined;
  if (cdmInit) {
    if (!cdmInit.path.isClassMethod()) {
      throw new AnalysisError("Not a class method: componentDidMount");
    }
    if (cdmInit.path.node.params.length > 0) {
      throw new AnalysisError("Invalid parameter of componentDidMount");
    }
    cdmPath = cdmInit.path;
  }
  if (cduInit) {
    if (!cduInit.path.isClassMethod()) {
      throw new AnalysisError("Not a class method: componentDidUpdate");
    }
    if (cduInit.path.node.params.length > 0) {
      throw new AnalysisError("Not supported: componentDidUpdate parameters");
    }
    cduPath = cduInit.path;
  }
  if (cwuInit) {
    if (!cwuInit.path.isClassMethod()) {
      throw new AnalysisError("Not a class method: componentWillUnmount");
    }
    if (cwuInit.path.node.params.length > 0) {
      throw new AnalysisError("Invalid parameter of componentWillUnmount");
    }
    cwuPath = cwuInit.path;
  }

  for (const [name, field] of userDefined.fields) {
    if (
      field.type === "user_defined_function"
      && field.sites.some((site) =>
        site.type === "expr"
        && site.owner === "componentWillUnmount"
        && !site.path.parentPath.isCallExpression()
      )
    ) {
      // A user-defined function is used without immediately calling in componentWillUnmount.
      // This is likely the following idiom:
      //
      // ```js
      // onMouseOver = () => {
      //   ...
      // }
      // componentDidMount() {
      //   this.div.addEventListener("mouseover", this.onMouseOver);
      // }
      // componentWillUnmount() {
      //   this.div.removeEventListener("mouseover", this.onMouseOver);
      // }
      // ```
      //
      // It may break in our "raw effect" transformation
      // because function identity may change over time.
      //
      // We will implement a separate paths for the patterns above,
      // but for now we just error out to avoid risks.

      throw new AnalysisError(`Possible event unregistration of ${name} in componentWillUnmount`);
    }
  }
  return {
    cdmPath,
    cduPath,
    cwuPath,
  };
}
