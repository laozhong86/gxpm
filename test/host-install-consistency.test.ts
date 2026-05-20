import { describe, test, expect } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("../", import.meta.url).pathname;

function listHostsFromInstallScripts(): string[] {
  const scriptsDir = join(REPO_ROOT, "scripts");
  return readdirSync(scriptsDir)
    .map((f) => f.match(/^install-([a-z0-9-]+)-hooks\.ts$/)?.[1])
    .filter((h): h is string => Boolean(h));
}

function listHostsFromAdapters(): string[] {
  const hostsDir = join(REPO_ROOT, "hosts");
  return readdirSync(hostsDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => f.replace(/\.ts$/, ""))
    .filter((name) => !["registry", "schema", "index"].includes(name) && !name.startsWith("adapters"));
}

describe("GXPM-142: host install scripts and adapters are aligned", () => {
  test("scn-01: at least three install-*-hooks.ts exist", () => {
    const hosts = listHostsFromInstallScripts();
    expect(hosts.length).toBeGreaterThanOrEqual(3);
  });

  test("scn-02: every install-X-hooks.ts has a matching hosts/X.ts adapter (warn-list)", () => {
    const installHosts = listHostsFromInstallScripts();
    const adapterHosts = new Set(listHostsFromAdapters());
    const orphanedInstall = installHosts.filter((h) => !adapterHosts.has(h));
    if (orphanedInstall.length > 0) {
      // Known drift: 'kimi' has install script but no hosts/kimi.ts adapter.
      // The test asserts the drift list against the known baseline so that
      // adding *new* drift fails CI, but existing drift is acknowledged.
      const knownDrift = new Set(["kimi"]);
      const newDrift = orphanedInstall.filter((h) => !knownDrift.has(h));
      if (newDrift.length > 0) {
        throw new Error(
          `New host drift: install script(s) without adapter — ${newDrift.join(", ")}. ` +
            `Add hosts/${newDrift[0]}.ts or remove the install script.`,
        );
      }
    }
    expect(orphanedInstall.every((h) => ["kimi"].includes(h))).toBe(true);
  });

  test("scn-03: every hosts/X.ts adapter has a matching install-X-hooks.ts (warn-list)", () => {
    const installHostSet = new Set(listHostsFromInstallScripts());
    const adapterHosts = listHostsFromAdapters();
    const orphanedAdapter = adapterHosts.filter((h) => !installHostSet.has(h));
    if (orphanedAdapter.length > 0) {
      const knownDrift = new Set(["cursor"]); // cursor has adapter but no install-hooks.ts script
      const newDrift = orphanedAdapter.filter((h) => !knownDrift.has(h));
      if (newDrift.length > 0) {
        throw new Error(
          `New host drift: adapter(s) without install script — ${newDrift.join(", ")}. ` +
            `Add scripts/install-${newDrift[0]}-hooks.ts or remove the adapter.`,
        );
      }
    }
    expect(orphanedAdapter.every((h) => ["cursor"].includes(h))).toBe(true);
  });

  test("scn-04: install-*-hooks.ts files are non-empty", () => {
    const hosts = listHostsFromInstallScripts();
    for (const host of hosts) {
      const path = join(REPO_ROOT, "scripts", `install-${host}-hooks.ts`);
      const stat = require("node:fs").statSync(path);
      expect(stat.size).toBeGreaterThan(0);
    }
  });
});
