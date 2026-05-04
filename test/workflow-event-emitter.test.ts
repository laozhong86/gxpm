import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  getWorkflowEventEmitter,
  resetWorkflowEventEmitter,
  type WorkflowEmitterEvent,
} from "../core/workflow-event-emitter";

describe("workflow event emitter", () => {
  beforeEach(() => {
    resetWorkflowEventEmitter();
  });

  afterEach(() => {
    resetWorkflowEventEmitter();
  });

  test("returns singleton instance", () => {
    const a = getWorkflowEventEmitter();
    const b = getWorkflowEventEmitter();
    expect(a).toBe(b);
  });

  test("emits events to subscribers", () => {
    const emitter = getWorkflowEventEmitter();
    const events: WorkflowEmitterEvent[] = [];

    const unsubscribe = emitter.subscribe((event) => {
      events.push(event);
    });

    emitter.emit({ type: "issue_created", issueId: "GXPM-1", issueType: "feature", timestamp: "2026-01-01T00:00:00.000Z" });
    emitter.emit({ type: "artifact_written", issueId: "GXPM-1", artifactType: "acceptance-contract", timestamp: "2026-01-01T00:00:01.000Z" });

    expect(events.length).toBe(2);
    expect(events[0].type).toBe("issue_created");
    expect(events[1].type).toBe("artifact_written");

    unsubscribe();
  });

  test("unsubscribe removes listener", () => {
    const emitter = getWorkflowEventEmitter();
    const events: WorkflowEmitterEvent[] = [];

    const unsubscribe = emitter.subscribe((event) => {
      events.push(event);
    });

    unsubscribe();
    emitter.emit({ type: "issue_created", issueId: "GXPM-1", issueType: "feature", timestamp: "2026-01-01T00:00:00.000Z" });

    expect(events.length).toBe(0);
  });

  test("listener errors do not propagate (fire-and-forget)", () => {
    const emitter = getWorkflowEventEmitter();
    const events: WorkflowEmitterEvent[] = [];

    emitter.subscribe(() => {
      throw new Error("boom");
    });

    emitter.subscribe((event) => {
      events.push(event);
    });

    emitter.emit({ type: "issue_created", issueId: "GXPM-1", issueType: "feature", timestamp: "2026-01-01T00:00:00.000Z" });

    expect(events.length).toBe(1);
  });

  test("subscribeForIssue filters by issueId", () => {
    const emitter = getWorkflowEventEmitter();
    const events: WorkflowEmitterEvent[] = [];

    const unsubscribe = emitter.subscribeForIssue("GXPM-2", (event) => {
      events.push(event);
    });

    emitter.emit({ type: "issue_created", issueId: "GXPM-1", issueType: "feature", timestamp: "2026-01-01T00:00:00.000Z" });
    emitter.emit({ type: "issue_created", issueId: "GXPM-2", issueType: "feature", timestamp: "2026-01-01T00:00:01.000Z" });
    emitter.emit({ type: "artifact_written", issueId: "GXPM-1", artifactType: "acceptance-contract", timestamp: "2026-01-01T00:00:02.000Z" });

    expect(events.length).toBe(1);
    expect(events[0].issueId).toBe("GXPM-2");

    unsubscribe();
  });

  test("reset clears instance and listeners", () => {
    const emitter = getWorkflowEventEmitter();
    const events: WorkflowEmitterEvent[] = [];

    emitter.subscribe((event) => {
      events.push(event);
    });

    resetWorkflowEventEmitter();
    const newEmitter = getWorkflowEventEmitter();

    expect(newEmitter).not.toBe(emitter);

    newEmitter.emit({ type: "issue_created", issueId: "GXPM-1", issueType: "feature", timestamp: "2026-01-01T00:00:00.000Z" });

    expect(events.length).toBe(0);
  });

  test("clear removes all listeners", () => {
    const emitter = getWorkflowEventEmitter();
    const events: WorkflowEmitterEvent[] = [];

    emitter.subscribe((event) => {
      events.push(event);
    });

    emitter.clear();
    emitter.emit({ type: "issue_created", issueId: "GXPM-1", issueType: "feature", timestamp: "2026-01-01T00:00:00.000Z" });

    expect(events.length).toBe(0);
  });
});
