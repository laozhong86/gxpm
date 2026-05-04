import { describe, it, expect } from "bun:test";
import { validateDagStructure, parseWorkflow } from "../core/dag-loader";
import type { DagNode } from "../core/dag-schemas";

describe("validateDagStructure", () => {
  it("accepts valid DAG with no dependencies", () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a" },
      { id: "b", type: "bash", bash: "echo b" },
    ];
    expect(validateDagStructure(nodes)).toBeNull();
  });

  it("accepts valid DAG with dependencies", () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a" },
      { id: "b", type: "bash", bash: "echo b", depends_on: ["a"] },
      { id: "c", type: "bash", bash: "echo c", depends_on: ["a", "b"] },
    ];
    expect(validateDagStructure(nodes)).toBeNull();
  });

  it("rejects duplicate ids", () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a" },
      { id: "a", type: "bash", bash: "echo a2" },
    ];
    expect(validateDagStructure(nodes)).toContain("Duplicate node id");
  });

  it("rejects missing dependency", () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a", depends_on: ["missing"] },
    ];
    expect(validateDagStructure(nodes)).toContain("depends_on unknown node");
  });

  it("rejects cyclic dependencies", () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a", depends_on: ["b"] },
      { id: "b", type: "bash", bash: "echo b", depends_on: ["a"] },
    ];
    expect(validateDagStructure(nodes)).toContain("Cycle detected");
  });

  it("rejects unknown $node.output reference", () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a", when: "$unknown.output === 'x'" },
    ];
    expect(validateDagStructure(nodes)).toContain("references unknown node");
  });

  it("accepts valid $node.output reference", () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a" },
      { id: "b", type: "bash", bash: "echo b", when: "$a.output === 'x'" },
    ];
    expect(validateDagStructure(nodes)).toBeNull();
  });
});

describe("parseWorkflow", () => {
  it("parses a valid workflow", () => {
    const raw = {
      name: "test-flow",
      description: "A test workflow",
      nodes: [
        { id: "a", type: "bash", bash: "echo a" },
        { id: "b", type: "bash", bash: "echo b", depends_on: ["a"] },
      ],
    };
    const result = parseWorkflow(raw);
    expect(result.error).toBeNull();
    expect(result.workflow).not.toBeNull();
    expect(result.workflow!.name).toBe("test-flow");
    expect(result.workflow!.nodes).toHaveLength(2);
  });

  it("rejects missing name", () => {
    const result = parseWorkflow({ description: "x", nodes: [] });
    expect(result.workflow).toBeNull();
    expect(result.error!.error).toContain("name");
  });

  it("rejects missing description", () => {
    const result = parseWorkflow({ name: "x", nodes: [] });
    expect(result.workflow).toBeNull();
    expect(result.error!.error).toContain("description");
  });

  it("rejects missing nodes", () => {
    const result = parseWorkflow({ name: "x", description: "y" });
    expect(result.workflow).toBeNull();
    expect(result.error!.error).toContain("nodes");
  });

  it("rejects invalid node type", () => {
    const result = parseWorkflow({
      name: "x",
      description: "y",
      nodes: [{ id: "a", type: "unknown" }],
    });
    expect(result.workflow).toBeNull();
    expect(result.error!.error).toContain("unknown or missing type");
  });

  it("rejects prompt node without prompt field", () => {
    const result = parseWorkflow({
      name: "x",
      description: "y",
      nodes: [{ id: "a", type: "prompt" }],
    });
    expect(result.workflow).toBeNull();
    expect(result.error!.error).toContain("prompt");
  });

  it("rejects bash node without bash field", () => {
    const result = parseWorkflow({
      name: "x",
      description: "y",
      nodes: [{ id: "a", type: "bash" }],
    });
    expect(result.workflow).toBeNull();
    expect(result.error!.error).toContain("bash");
  });

  it("parses all node types", () => {
    const raw = {
      name: "all-types",
      description: "test all node types",
      nodes: [
        { id: "p", type: "prompt", prompt: "hello" },
        { id: "b", type: "bash", bash: "echo hi" },
        { id: "s", type: "script", script: "./run.sh" },
        { id: "ph", type: "phase", phase: "implement" },
        { id: "ap", type: "approval", message: "ok?" },
        { id: "cn", type: "cancel" },
      ],
    };
    const result = parseWorkflow(raw);
    expect(result.error).toBeNull();
    expect(result.workflow!.nodes).toHaveLength(6);
  });
});
