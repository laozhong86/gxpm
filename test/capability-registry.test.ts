import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACT_TYPES } from "../core/artifacts";
import {
  CAPABILITY_MUTATION_SCOPES,
  CAPABILITY_REGISTRY,
  CAPABILITY_RUNTIMES,
  CAPABILITY_STATUSES,
  getCapability,
  listCapabilities,
  requireCapability,
} from "../core/capabilities";
import { output, runCli } from "./helpers/workflow";

describe("capability registry", () => {
  test("declares unique first-party capability contracts", () => {
    const capabilities = listCapabilities();

    expect(capabilities.length).toBeGreaterThan(0);
    expect(new Set(capabilities.map((capability) => capability.id)).size).toBe(capabilities.length);
    expect(capabilities).toEqual(CAPABILITY_REGISTRY);
  });

  test("requires contract fields for every capability", () => {
    for (const capability of listCapabilities()) {
      expect(capability.id).toMatch(/^[a-z]+[a-z0-9-]*(\.[a-z]+[a-z0-9-]*)+$/);
      expect(capability.title).toBeTruthy();
      expect(capability.summary).toBeTruthy();
      expect(CAPABILITY_RUNTIMES).toContain(capability.runtime);
      expect(CAPABILITY_STATUSES).toContain(capability.status);
      expect(capability.inputContract).toBeTruthy();
      expect(capability.outputContract.description).toBeTruthy();
      expect(CAPABILITY_MUTATION_SCOPES).toContain(capability.mutationPolicy.scope);
      expect(capability.mutationPolicy.description).toBeTruthy();
      expect(capability.idempotency).toBeTruthy();
      expect(capability.failureModes.length).toBeGreaterThan(0);
      expect(capability.commands.length).toBeGreaterThan(0);
      expect(capability.sourceFiles.length).toBeGreaterThan(0);
      for (const artifact of capability.outputContract.artifacts) {
        expect(ARTIFACT_TYPES).toContain(artifact);
      }
    }
  });

  test("keeps source file anchors resolvable", () => {
    const root = join(import.meta.dir, "..");

    for (const capability of listCapabilities()) {
      for (const sourceFile of capability.sourceFiles) {
        expect(existsSync(join(root, sourceFile))).toBe(true);
      }
    }
  });

  test("retrieves capabilities by id", () => {
    expect(getCapability("issue.readiness")?.runtime).toBe("issue");
    expect(getCapability("missing.capability")).toBeNull();
    expect(() => requireCapability("missing.capability")).toThrow("Unknown capability: missing.capability");
  });
});

describe("gxpm capability CLI", () => {
  test("lists capability contracts as JSON", () => {
    const result = runCli(process.cwd(), ["capability", "list", "--json"]);

    expect(result.exitCode).toBe(0);
    const capabilities = JSON.parse(output(result));
    expect(capabilities.map((capability: { id: string }) => capability.id)).toContain("issue.readiness");
  });

  test("shows one capability in human and JSON formats", () => {
    const human = runCli(process.cwd(), ["capability", "show", "execution.orchestrator-dry-run"]);
    expect(human.exitCode).toBe(0);
    expect(output(human)).toContain("id: execution.orchestrator-dry-run");
    expect(output(human)).toContain("mutation: none");

    const json = runCli(process.cwd(), ["capability", "show", "execution.orchestrator-dry-run", "--json"]);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(output(json)).id).toBe("execution.orchestrator-dry-run");
  });

  test("returns non-zero for an unknown capability id", () => {
    const result = runCli(process.cwd(), ["capability", "show", "missing.capability"]);

    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("Unknown capability: missing.capability");
  });
});
