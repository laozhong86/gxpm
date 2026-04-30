import { listCapabilities, requireCapability } from "../../core/capabilities";

export function runCapabilityCommand(
  argv: string[],
  subcommand: string | undefined,
  capabilityId: string | undefined,
) {
  if (subcommand === "list") {
    const capabilities = listCapabilities();
    if (argv.includes("--json")) {
      console.log(JSON.stringify(capabilities, null, 2));
      return;
    }
    const idWidth = Math.max("ID".length, ...capabilities.map((capability) => capability.id.length));
    const runtimeWidth = Math.max(
      "RUNTIME".length,
      ...capabilities.map((capability) => capability.runtime.length),
    );
    console.log(`${"ID".padEnd(idWidth)}  ${"RUNTIME".padEnd(runtimeWidth)}  STATUS   MUTATION`);
    for (const capability of capabilities) {
      console.log(
        `${capability.id.padEnd(idWidth)}  ${capability.runtime.padEnd(runtimeWidth)}  ${capability.status.padEnd(7)}  ${capability.mutationPolicy.scope}`,
      );
    }
    return;
  }

  if (subcommand === "show") {
    if (!capabilityId || capabilityId.startsWith("--")) {
      throw new Error("Usage: gxpm capability show <capability-id> [--json]");
    }
    const capability = requireCapability(capabilityId);
    if (argv.includes("--json")) {
      console.log(JSON.stringify(capability, null, 2));
      return;
    }
    console.log(`id: ${capability.id}`);
    console.log(`title: ${capability.title}`);
    console.log(`runtime: ${capability.runtime}`);
    console.log(`status: ${capability.status}`);
    console.log(`mutation: ${capability.mutationPolicy.scope}`);
    console.log(`input: ${capability.inputContract}`);
    console.log(`output: ${capability.outputContract.description}`);
    console.log(`idempotency: ${capability.idempotency}`);
    console.log("failureModes:");
    for (const mode of capability.failureModes) {
      console.log(`- ${mode}`);
    }
    console.log("commands:");
    for (const command of capability.commands) {
      console.log(`- ${command}`);
    }
    return;
  }

  throw new Error("Usage: gxpm capability list [--json]\n       gxpm capability show <capability-id> [--json]");
}
