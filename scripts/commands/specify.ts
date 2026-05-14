import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { confirmSpecify, reviseSpecify } from "../../core/specify";

function specPath(issueId: string): string {
  return join(process.cwd(), ".gxpm", "issues", issueId, "artifacts", "behavior-spec.json");
}

function runConfirm(issueId: string) {
  if (!issueId) {
    throw new Error("usage: gxpm specify confirm <issue-id>");
  }
  confirmSpecify({ issueId });
  console.log(`confirmed behavior-spec for ${issueId}`);
}

function runRevise(issueId: string) {
  if (!issueId) {
    throw new Error("usage: gxpm specify revise <issue-id>");
  }
  reviseSpecify({ issueId });
  console.log(`revised behavior-spec for ${issueId} (confirmedAt cleared)`);
}

function runShow(issueId: string) {
  if (!issueId) {
    throw new Error("usage: gxpm specify show <issue-id>");
  }
  const path = specPath(issueId);
  if (!existsSync(path)) {
    throw new Error(`behavior-spec.json not found for ${issueId}`);
  }
  const stored = JSON.parse(readFileSync(path, "utf8"));
  const spec = stored.payload;
  console.log(`Feature: ${spec.feature.title}`);
  console.log(`  As a ${spec.feature.asA}`);
  console.log(`  I want ${spec.feature.iWant}`);
  console.log(`  So that ${spec.feature.soThat}`);
  console.log("");
  for (const scn of spec.scenarios) {
    console.log(`Scenario (${scn.id}): ${scn.name}`);
    for (const g of scn.given) console.log(`  Given ${g}`);
    console.log(`  When ${scn.when}`);
    for (const t of scn.then) console.log(`  Then ${t}`);
    console.log(`  Stub: ${scn.stubPath}`);
    console.log("");
  }
  console.log(`confirmedAt: ${spec.confirmedAt ?? "(not confirmed)"}`);
}

export function runSpecifyCommand(
  _argv: string[],
  subcommand: string | undefined,
  issueId: string | undefined,
) {
  switch (subcommand) {
    case "confirm":
      runConfirm(issueId ?? "");
      return;
    case "revise":
      runRevise(issueId ?? "");
      return;
    case "show":
      runShow(issueId ?? "");
      return;
    default:
      throw new Error(
        `unknown specify subcommand: ${subcommand ?? "<none>"}; expected confirm|revise|show`,
      );
  }
}
