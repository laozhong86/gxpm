/**
 * Template Engine — Variable substitution and inter-node data flow for
 * capability prompts and skill templates.
 *
 * Inspired by Archon dag-executor.ts and executor-shared.ts, but stripped
 * of provider/platform dependencies to remain a pure string-replacement
 * utility that gxpm capabilities can call.
 */

export interface NodeOutput {
  state: string;
  output: string;
  error?: string;
}

export interface SubstitutionContext {
  workflowId?: string;
  userMessage?: string;
  artifactsDir?: string;
  baseBranch?: string;
  docsDir?: string;
  loopUserInput?: string;
  rejectionReason?: string;
  loopPrevOutput?: string;
  issueContext?: string;
}

const CONTEXT_VAR_PATTERN = /\$CONTEXT|\$EXTERNAL_CONTEXT|\$ISSUE_CONTEXT/g;

/**
 * Substitute workflow-level variables in a template.
 *
 * Supported variables:
 *   $WORKFLOW_ID, $USER_MESSAGE, $ARGUMENTS, $ARTIFACTS_DIR,
 *   $BASE_BRANCH, $DOCS_DIR, $LOOP_USER_INPUT, $REJECTION_REASON,
 *   $LOOP_PREV_OUTPUT, $CONTEXT, $EXTERNAL_CONTEXT, $ISSUE_CONTEXT
 *
 * Returns the substituted prompt and a flag indicating whether a $CONTEXT
 * variable was present (used by buildPromptWithContext to avoid duplication).
 */
export function substituteWorkflowVariables(
  template: string,
  context: SubstitutionContext = {}
): { prompt: string; contextSubstituted: boolean } {
  if (!context.baseBranch && template.includes("$BASE_BRANCH")) {
    throw new Error(
      "No base branch could be resolved. " +
        "Set worktree.baseBranch in .gxpm/config.json or use --from flag."
    );
  }

  const resolvedDocsDir = context.docsDir || "docs/";

  let result = template
    .replace(/\$WORKFLOW_ID/g, context.workflowId ?? "")
    .replace(/\$USER_MESSAGE/g, context.userMessage ?? "")
    .replace(/\$ARGUMENTS/g, context.userMessage ?? "")
    .replace(/\$ARTIFACTS_DIR/g, context.artifactsDir ?? "")
    .replace(/\$BASE_BRANCH/g, context.baseBranch ?? "")
    .replace(/\$DOCS_DIR/g, resolvedDocsDir)
    .replace(/\$LOOP_USER_INPUT/g, context.loopUserInput ?? "")
    .replace(/\$REJECTION_REASON/g, context.rejectionReason ?? "")
    .replace(/\$LOOP_PREV_OUTPUT/g, context.loopPrevOutput ?? "");

  const hasContextVariables = CONTEXT_VAR_PATTERN.test(result);

  if (!context.issueContext && hasContextVariables) {
    // Clear context variables when no context is provided
  }

  result = result.replace(CONTEXT_VAR_PATTERN, context.issueContext ?? "");

  return {
    prompt: result,
    contextSubstituted: hasContextVariables && !!context.issueContext,
  };
}

/**
 * Build a final prompt by substituting workflow variables and optionally
 * appending issue context when it was not already substituted inline.
 */
export function buildPromptWithContext(
  template: string,
  context: SubstitutionContext = {}
): string {
  const { prompt, contextSubstituted } = substituteWorkflowVariables(
    template,
    context
  );

  if (context.issueContext && !contextSubstituted) {
    return prompt + "\n\n---\n\n" + context.issueContext;
  }

  return prompt;
}

/**
 * Single-quote a string for safe inline shell use.
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Substitute $nodeId.output and $nodeId.output.field references in a prompt.
 *
 * Called *after* the standard substituteWorkflowVariables pass.
 *
 * @param prompt - The prompt template with variable placeholders
 * @param nodeOutputs - Map of node IDs to their outputs
 * @param escapedForBash - When true, wraps substituted values in single quotes
 *   so they are safe to embed in bash scripts. Set true only for bash node
 *   script substitution; AI/command prompt substitution should use false.
 */
export function substituteNodeOutputRefs(
  prompt: string,
  nodeOutputs: Map<string, NodeOutput>,
  escapedForBash = false
): string {
  return prompt.replace(
    /\$([a-zA-Z_][a-zA-Z0-9_-]*)\.output(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g,
    (match, nodeId: string, field: string | undefined) => {
      const nodeOutput = nodeOutputs.get(nodeId);
      if (!nodeOutput) {
        return escapedForBash ? "''" : "";
      }
      if (!field) {
        return escapedForBash
          ? shellQuote(nodeOutput.output)
          : nodeOutput.output;
      }
      try {
        const parsed = JSON.parse(nodeOutput.output) as Record<
          string,
          unknown
        >;
        const value = parsed[field];
        if (typeof value === "string") {
          return escapedForBash ? shellQuote(value) : value;
        }
        if (typeof value === "number" || typeof value === "boolean") {
          return String(value);
        }
        return escapedForBash ? "''" : "";
      } catch {
        return escapedForBash ? "''" : "";
      }
    }
  );
}
