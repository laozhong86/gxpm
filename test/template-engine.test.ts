import { describe, expect, test } from "bun:test";
import {
  buildPromptWithContext,
  substituteNodeOutputRefs,
  substituteWorkflowVariables,
  type NodeOutput,
  type SubstitutionContext,
} from "../core/template-engine";

describe("substituteWorkflowVariables", () => {
  test("replaces basic variables", () => {
    const result = substituteWorkflowVariables(
      "id=$WORKFLOW_ID msg=$USER_MESSAGE dir=$ARTIFACTS_DIR branch=$BASE_BRANCH docs=$DOCS_DIR",
      {
        workflowId: "wf-123",
        userMessage: "hello",
        artifactsDir: "/tmp/art",
        baseBranch: "main",
        docsDir: "docs/",
      }
    );
    expect(result.prompt).toBe(
      "id=wf-123 msg=hello dir=/tmp/art branch=main docs=docs/"
    );
    expect(result.contextSubstituted).toBe(false);
  });

  test("$ARGUMENTS aliases $USER_MESSAGE", () => {
    const result = substituteWorkflowVariables("args=$ARGUMENTS", {
      userMessage: "do it",
    });
    expect(result.prompt).toBe("args=do it");
  });

  test("clears missing variables to empty string", () => {
    const result = substituteWorkflowVariables(
      "id=$WORKFLOW_ID msg=$USER_MESSAGE"
    );
    expect(result.prompt).toBe("id= msg=");
  });

  test("throws when $BASE_BRANCH is referenced but not provided", () => {
    expect(() =>
      substituteWorkflowVariables("branch=$BASE_BRANCH")
    ).toThrow("No base branch could be resolved");
  });

  test("defaults docsDir to docs/", () => {
    const result = substituteWorkflowVariables("docs=$DOCS_DIR");
    expect(result.prompt).toBe("docs=docs/");
  });

  test("substitutes loop and rejection variables", () => {
    const result = substituteWorkflowVariables(
      "input=$LOOP_USER_INPUT reason=$REJECTION_REASON prev=$LOOP_PREV_OUTPUT",
      {
        loopUserInput: "retry",
        rejectionReason: "bad format",
        loopPrevOutput: "previous result",
      }
    );
    expect(result.prompt).toBe("input=retry reason=bad format prev=previous result");
  });

  test("substitutes $CONTEXT when issueContext provided", () => {
    const result = substituteWorkflowVariables(
      "context: $CONTEXT end",
      { issueContext: "issue-42 details" }
    );
    expect(result.prompt).toBe("context: issue-42 details end");
    expect(result.contextSubstituted).toBe(true);
  });

  test("substitutes $EXTERNAL_CONTEXT and $ISSUE_CONTEXT", () => {
    const result = substituteWorkflowVariables(
      "$EXTERNAL_CONTEXT | $ISSUE_CONTEXT",
      { issueContext: "same" }
    );
    expect(result.prompt).toBe("same | same");
    expect(result.contextSubstituted).toBe(true);
  });

  test("clears context variables when no issueContext provided", () => {
    const result = substituteWorkflowVariables("$CONTEXT $EXTERNAL_CONTEXT");
    expect(result.prompt).toBe(" ");
    expect(result.contextSubstituted).toBe(false);
  });
});

describe("buildPromptWithContext", () => {
  test("appends context when not substituted inline", () => {
    const result = buildPromptWithContext("Do the thing.", {
      issueContext: "Issue #42: fix bug",
    });
    expect(result).toBe("Do the thing.\n\n---\n\nIssue #42: fix bug");
  });

  test("does not duplicate context when already substituted", () => {
    const result = buildPromptWithContext("Context: $CONTEXT", {
      issueContext: "Issue #42: fix bug",
    });
    expect(result).toBe("Context: Issue #42: fix bug");
  });

  test("returns prompt unchanged when no issueContext", () => {
    const result = buildPromptWithContext("Do the thing.");
    expect(result).toBe("Do the thing.");
  });
});

describe("substituteNodeOutputRefs", () => {
  const outputs = new Map<string, NodeOutput>([
    ["node-a", { state: "completed", output: "result from A" }],
    [
      "node-b",
      { state: "completed", output: JSON.stringify({ count: 5, name: "test" }) },
    ],
    ["node-c", { state: "completed", output: "has 'quotes' and \"double\"" }],
  ]);

  test("replaces $nodeId.output with full output", () => {
    const result = substituteNodeOutputRefs(
      "A said: $node-a.output",
      outputs
    );
    expect(result).toBe("A said: result from A");
  });

  test("replaces $nodeId.output.field with JSON field", () => {
    const result = substituteNodeOutputRefs(
      "Count: $node-b.output.count, Name: $node-b.output.name",
      outputs
    );
    expect(result).toBe("Count: 5, Name: test");
  });

  test("returns empty string for unknown node", () => {
    const result = substituteNodeOutputRefs(
      "X: $unknown.output",
      outputs
    );
    expect(result).toBe("X: ");
  });

  test("returns empty string for invalid JSON when field requested", () => {
    const badOutputs = new Map<string, NodeOutput>([
      ["bad", { state: "completed", output: "not json" }],
    ]);
    const result = substituteNodeOutputRefs(
      "field: $bad.output.field",
      badOutputs
    );
    expect(result).toBe("field: ");
  });

  test("returns empty string for missing field", () => {
    const result = substituteNodeOutputRefs(
      "Missing: $node-b.output.missing",
      outputs
    );
    expect(result).toBe("Missing: ");
  });

  test("handles numbers and booleans without bash quoting", () => {
    const jsonOutputs = new Map<string, NodeOutput>([
      [
        "num",
        { state: "completed", output: JSON.stringify({ active: true, score: 3.14 }) },
      ],
    ]);
    const result = substituteNodeOutputRefs(
      "$num.output.active $num.output.score",
      jsonOutputs
    );
    expect(result).toBe("true 3.14");
  });

  test("shell-quotes string values when escapedForBash=true", () => {
    const result = substituteNodeOutputRefs(
      "echo $node-a.output",
      outputs,
      true
    );
    expect(result).toBe("echo 'result from A'");
  });

  test("shell-quotes JSON string fields when escapedForBash=true", () => {
    const result = substituteNodeOutputRefs(
      "echo $node-b.output.name",
      outputs,
      true
    );
    expect(result).toBe("echo 'test'");
  });

  test("does not shell-quote numbers/booleans", () => {
    const result = substituteNodeOutputRefs(
      "echo $node-b.output.count",
      outputs,
      true
    );
    expect(result).toBe("echo 5");
  });

  test("handles single quotes in shell mode", () => {
    const result = substituteNodeOutputRefs(
      "echo $node-c.output",
      outputs,
      true
    );
    expect(result).toBe("echo 'has '\\''quotes'\\'' and \"double\"'");
  });

  test("returns empty quoted string for unknown node in bash mode", () => {
    const result = substituteNodeOutputRefs(
      "echo $unknown.output",
      outputs,
      true
    );
    expect(result).toBe("echo ''");
  });

  test("replaces multiple references in one prompt", () => {
    const result = substituteNodeOutputRefs(
      "A=$node-a.output B=$node-b.output.count",
      outputs
    );
    expect(result).toBe("A=result from A B=5");
  });
});
