import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createIssueState,
  getIssuePaths,
  isIssueType,
  ISSUE_TYPES,
  type IssueType,
} from "../../core/state";
import { writeArtifact } from "../../core/artifacts";
import { getResolvedConfigValue } from "../../core/config";
import { getNextAvailableIssueId } from "../../core/issues";
import { optionRequiredValue, optionValue } from "./helpers";

const ISSUE_TYPE_USAGE = ISSUE_TYPES.join("|");
const FEEDBACK_CREATE_USAGE = `Usage: gxpm feedback create <issue-id>|--auto-id [--title <title>] [--description <text>] [--type ${ISSUE_TYPE_USAGE}]`;

export async function runFeedbackCommand(argv: string[], subcommand: string | undefined) {
  if (subcommand === "create") {
    await runFeedbackCreate(argv);
    return;
  }

  console.log(`Usage: gxpm feedback <subcommand>

Subcommands:
  create <issue-id>|--auto-id [--title <title>] [--description <text>] [--type meta|feature|spike]`);
}

async function runFeedbackCreate(argv: string[]) {
  const sourceRoot = resolveFeedbackSourceRoot();
  const args = argv.slice(2);

  const hasAutoId = args.includes("--auto-id");
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--auto-id") continue;
    if (arg === "--title" || arg === "--description" || arg === "--type") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option for gxpm feedback create: ${arg}`);
    }
    positional.push(arg);
  }

  if (hasAutoId && positional.length > 0) {
    throw new Error(FEEDBACK_CREATE_USAGE);
  }
  if (positional.length > 1) {
    throw new Error(FEEDBACK_CREATE_USAGE);
  }

  const issueId = positional[0] ?? (hasAutoId ? getNextAvailableIssueId({ root: sourceRoot }) : undefined);
  if (!issueId) {
    throw new Error(FEEDBACK_CREATE_USAGE);
  }

  const title = optionValue(argv, "--title") ?? undefined;
  const description = optionValue(argv, "--description") ?? undefined;
  const issueType = parseFeedbackIssueType(argv);

  // Ensure .gxpm directory exists in source root
  const gxpmDir = join(sourceRoot, ".gxpm");
  if (!existsSync(gxpmDir)) {
    throw new Error(
      `Feedback source root does not appear to be a gxpm repository: ${sourceRoot}\n` +
        `Missing .gxpm directory. Set feedback.gxpmSourceRoot to a valid gxpm repo path.`,
    );
  }

  const state = createIssueState({ root: sourceRoot, issueId, issueType });

  // Write feedback-description artifact when title or description is provided
  if (title || description) {
    writeArtifact({
      root: sourceRoot,
      issueId,
      type: "feedback-description",
      payload: {
        title: title ?? "",
        description: description ?? "",
        reportedFrom: process.cwd(),
        reportedAt: new Date().toISOString(),
      },
    });
  }

  console.log(`created feedback issue ${state.issueId} at ${state.currentPhase}`);
  console.log(`type: ${state.issueType}`);
  console.log(`sourceRoot: ${sourceRoot}`);
  console.log(`statePath: ${getIssuePaths(sourceRoot, issueId).statePath}`);
  if (title) {
    console.log(`title: ${title}`);
  }
  if (description) {
    console.log(`description: ${description}`);
  }
}

function resolveFeedbackSourceRoot(): string {
  const resolved = getResolvedConfigValue({ key: "feedback.gxpmSourceRoot" });
  const raw = String(resolved.value ?? "").trim();
  if (!raw) {
    throw new Error(
      `feedback.gxpmSourceRoot is not configured.\n` +
        `Set it with: gxpm config set feedback.gxpmSourceRoot </absolute/path/to/gxpm/repo>`,
    );
  }
  return resolve(raw);
}

function parseFeedbackIssueType(argv: string[]): IssueType {
  const raw = optionValue(argv, "--type");
  if (!raw) return "meta";
  if (!isIssueType(raw)) {
    throw new Error(`Invalid issue type: ${raw}; expected ${ISSUE_TYPE_USAGE}`);
  }
  return raw;
}
