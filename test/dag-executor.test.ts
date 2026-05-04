import { describe, it, expect } from "bun:test";
import type { DagNode, NodeOutput } from "../core/dag-schemas";
import {
  buildTopologicalLayers,
  checkTriggerRule,
  substituteNodeOutputRefs,
  evaluateWhenCondition,
  executeDag,
  type NodeExecutor,
} from "../core/dag-executor";

describe("buildTopologicalLayers", () => {
  it("returns single layer for independent nodes", () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a" },
      { id: "b", type: "bash", bash: "echo b" },
    ];
    const layers = buildTopologicalLayers(nodes);
    expect(layers).toHaveLength(1);
    expect(layers[0].map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("returns correct layers for chain", () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a" },
      { id: "b", type: "bash", bash: "echo b", depends_on: ["a"] },
      { id: "c", type: "bash", bash: "echo c", depends_on: ["b"] },
    ];
    const layers = buildTopologicalLayers(nodes);
    expect(layers).toHaveLength(3);
    expect(layers[0].map((n) => n.id)).toEqual(["a"]);
    expect(layers[1].map((n) => n.id)).toEqual(["b"]);
    expect(layers[2].map((n) => n.id)).toEqual(["c"]);
  });

  it("groups independent nodes in same layer even with shared dependencies", () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a" },
      { id: "b", type: "bash", bash: "echo b", depends_on: ["a"] },
      { id: "c", type: "bash", bash: "echo c", depends_on: ["a"] },
    ];
    const layers = buildTopologicalLayers(nodes);
    expect(layers).toHaveLength(2);
    expect(layers[0].map((n) => n.id)).toEqual(["a"]);
    expect(layers[1].map((n) => n.id).sort()).toEqual(["b", "c"]);
  });

  it("throws on cycle", () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a", depends_on: ["b"] },
      { id: "b", type: "bash", bash: "echo b", depends_on: ["a"] },
    ];
    expect(() => buildTopologicalLayers(nodes)).toThrow("Cycle detected");
  });
});

describe("checkTriggerRule", () => {
  const makeOutputs = (
    states: Record<string, NodeState>
  ): Map<string, NodeOutput> => {
    const map = new Map<string, NodeOutput>();
    for (const [id, state] of Object.entries(states)) {
      map.set(id, { state, output: "" });
    }
    return map;
  };

  it("all_success requires all upstreams completed", () => {
    const node: DagNode = {
      id: "x",
      type: "bash",
      bash: "echo x",
      depends_on: ["a", "b"],
      trigger_rule: "all_success",
    };
    expect(checkTriggerRule(node, makeOutputs({ a: "completed", b: "completed" }))).toBe("run");
    expect(checkTriggerRule(node, makeOutputs({ a: "completed", b: "failed" }))).toBe("skip");
    expect(checkTriggerRule(node, makeOutputs({ a: "failed", b: "failed" }))).toBe("skip");
  });

  it("one_success requires at least one upstream completed", () => {
    const node: DagNode = {
      id: "x",
      type: "bash",
      bash: "echo x",
      depends_on: ["a", "b"],
      trigger_rule: "one_success",
    };
    expect(checkTriggerRule(node, makeOutputs({ a: "completed", b: "failed" }))).toBe("run");
    expect(checkTriggerRule(node, makeOutputs({ a: "failed", b: "failed" }))).toBe("skip");
  });

  it("none_failed_min_one_success requires no failures and at least one success", () => {
    const node: DagNode = {
      id: "x",
      type: "bash",
      bash: "echo x",
      depends_on: ["a", "b"],
      trigger_rule: "none_failed_min_one_success",
    };
    expect(checkTriggerRule(node, makeOutputs({ a: "completed", b: "completed" }))).toBe("run");
    expect(checkTriggerRule(node, makeOutputs({ a: "completed", b: "skipped" }))).toBe("run");
    expect(checkTriggerRule(node, makeOutputs({ a: "completed", b: "failed" }))).toBe("skip");
    expect(checkTriggerRule(node, makeOutputs({ a: "skipped", b: "skipped" }))).toBe("skip");
  });

  it("all_done requires all upstreams not pending/running", () => {
    const node: DagNode = {
      id: "x",
      type: "bash",
      bash: "echo x",
      depends_on: ["a", "b"],
      trigger_rule: "all_done",
    };
    expect(checkTriggerRule(node, makeOutputs({ a: "completed", b: "failed" }))).toBe("run");
    expect(checkTriggerRule(node, makeOutputs({ a: "completed", b: "running" }))).toBe("skip");
  });

  it("defaults to all_success", () => {
    const node: DagNode = {
      id: "x",
      type: "bash",
      bash: "echo x",
      depends_on: ["a"],
    };
    expect(checkTriggerRule(node, makeOutputs({ a: "completed" }))).toBe("run");
    expect(checkTriggerRule(node, makeOutputs({ a: "failed" }))).toBe("skip");
  });

  it("returns run for no dependencies", () => {
    const node: DagNode = { id: "x", type: "bash", bash: "echo x" };
    expect(checkTriggerRule(node, new Map())).toBe("run");
  });
});

describe("substituteNodeOutputRefs", () => {
  it("substitutes simple output refs", () => {
    const outputs = new Map<string, NodeOutput>();
    outputs.set("a", { state: "completed", output: "hello" });
    expect(substituteNodeOutputRefs("$a.output", outputs)).toBe("hello");
  });

  it("substitutes field refs from JSON output", () => {
    const outputs = new Map<string, NodeOutput>();
    outputs.set("a", { state: "completed", output: '{"name":"world"}' });
    expect(substituteNodeOutputRefs("$a.output.name", outputs)).toBe("world");
  });

  it("returns empty for unknown node", () => {
    const outputs = new Map<string, NodeOutput>();
    expect(substituteNodeOutputRefs("$a.output", outputs)).toBe("");
  });

  it("returns empty for invalid JSON with field ref", () => {
    const outputs = new Map<string, NodeOutput>();
    outputs.set("a", { state: "completed", output: "not-json" });
    expect(substituteNodeOutputRefs("$a.output.name", outputs)).toBe("");
  });

  it("handles multiple refs", () => {
    const outputs = new Map<string, NodeOutput>();
    outputs.set("a", { state: "completed", output: "hello" });
    outputs.set("b", { state: "completed", output: "world" });
    expect(substituteNodeOutputRefs("$a.output $b.output", outputs)).toBe("hello world");
  });
});

describe("evaluateWhenCondition", () => {
  it("returns true for empty condition", () => {
    expect(evaluateWhenCondition("", new Map())).toBe(true);
  });

  it("evaluates simple boolean expression", () => {
    expect(evaluateWhenCondition("true", new Map())).toBe(true);
    expect(evaluateWhenCondition("false", new Map())).toBe(false);
  });

  it("evaluates comparison with substituted output", () => {
    const outputs = new Map<string, NodeOutput>();
    outputs.set("a", { state: "completed", output: "hello" });
    expect(evaluateWhenCondition("$a.output === 'hello'", outputs)).toBe(true);
    expect(evaluateWhenCondition("$a.output === 'world'", outputs)).toBe(false);
  });

  it("evaluates numeric comparison", () => {
    const outputs = new Map<string, NodeOutput>();
    outputs.set("a", { state: "completed", output: "42" });
    expect(evaluateWhenCondition("Number($a.output) > 10", outputs)).toBe(true);
    expect(evaluateWhenCondition("Number($a.output) < 10", outputs)).toBe(false);
  });

  it("evaluates logical operators", () => {
    expect(evaluateWhenCondition("true && false", new Map())).toBe(false);
    expect(evaluateWhenCondition("true || false", new Map())).toBe(true);
  });

  it("throws on disallowed characters", () => {
    expect(() => evaluateWhenCondition("1 ~ 2", new Map())).toThrow(
      "disallowed characters"
    );
  });

  it("throws on disallowed keywords", () => {
    expect(() => evaluateWhenCondition("eval('1')", new Map())).toThrow("disallowed keyword");
  });
});

describe("executeDag", () => {
  const echoExecutor: NodeExecutor = async (node) => {
    if ("bash" in node && node.bash) {
      return { state: "completed", output: node.bash };
    }
    return { state: "completed", output: "done" };
  };

  const failExecutor: NodeExecutor = async (node) => {
    if (node.id === "fail") {
      return { state: "failed", output: "", error: "intentional failure" };
    }
    return { state: "completed", output: "done" };
  };

  it("executes independent nodes concurrently", async () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a" },
      { id: "b", type: "bash", bash: "echo b" },
    ];
    const result = await executeDag(nodes, echoExecutor);
    expect(result.success).toBe(true);
    expect(result.nodeOutputs.get("a")!.output).toBe("echo a");
    expect(result.nodeOutputs.get("b")!.output).toBe("echo b");
  });

  it("executes dependent nodes in order", async () => {
    const executionOrder: string[] = [];
    const trackingExecutor: NodeExecutor = async (node) => {
      executionOrder.push(node.id);
      return { state: "completed", output: node.id };
    };

    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a" },
      { id: "b", type: "bash", bash: "echo b", depends_on: ["a"] },
      { id: "c", type: "bash", bash: "echo c", depends_on: ["b"] },
    ];
    const result = await executeDag(nodes, trackingExecutor);
    expect(result.success).toBe(true);
    expect(executionOrder).toEqual(["a", "b", "c"]);
  });

  it("skips nodes via trigger rule", async () => {
    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a" },
      { id: "b", type: "bash", bash: "echo b" },
      {
        id: "c",
        type: "bash",
        bash: "echo c",
        depends_on: ["a", "b"],
        trigger_rule: "all_success",
      },
    ];

    const conditionalExecutor: NodeExecutor = async (node) => {
      if (node.id === "b") {
        return { state: "failed", output: "", error: "fail" };
      }
      return { state: "completed", output: node.id };
    };

    const result = await executeDag(nodes, conditionalExecutor);
    expect(result.success).toBe(false);
    expect(result.nodeOutputs.get("c")!.state).toBe("skipped");
  });

  it("handles node failure without cancel", async () => {
    const nodes: DagNode[] = [
      { id: "ok", type: "bash", bash: "echo ok" },
      { id: "fail", type: "bash", bash: "echo fail" },
    ];
    const result = await executeDag(nodes, failExecutor);
    expect(result.success).toBe(false);
    expect(result.nodeOutputs.get("fail")!.state).toBe("failed");
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const nodes: DagNode[] = [{ id: "a", type: "bash", bash: "echo a" }];
    const result = await executeDag(nodes, echoExecutor, {
      abortSignal: controller.signal,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Aborted");
  });

  it("calls lifecycle hooks", async () => {
    const started: string[] = [];
    const completed: string[] = [];

    const nodes: DagNode[] = [
      { id: "a", type: "bash", bash: "echo a" },
      { id: "b", type: "bash", bash: "echo b" },
    ];

    await executeDag(nodes, echoExecutor, {
      onNodeStart: (id) => started.push(id),
      onNodeComplete: (id) => completed.push(id),
    });

    expect(started.sort()).toEqual(["a", "b"]);
    expect(completed.sort()).toEqual(["a", "b"]);
  });

  it("retries transient failures", async () => {
    let attempts = 0;
    const retryExecutor: NodeExecutor = async (node) => {
      attempts++;
      if (attempts < 3) {
        return { state: "failed", output: "", error: "timeout" };
      }
      return { state: "completed", output: "recovered" };
    };

    const nodes: DagNode[] = [
      {
        id: "a",
        type: "bash",
        bash: "echo a",
        retry: { max_attempts: 3, delay_ms: 10 },
      },
    ];

    const result = await executeDag(nodes, retryExecutor);
    expect(result.success).toBe(true);
    expect(result.nodeOutputs.get("a")!.output).toBe("recovered");
    expect(attempts).toBe(3);
  });
});
