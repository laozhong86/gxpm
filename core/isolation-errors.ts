/**
 * Isolation error classifier.
 *
 * Maps git/worktree infrastructure errors to actionable user messages.
 * Distinguishes known infrastructure failures (blocked) from unknown
 * programming/input bugs (should crash).
 */

export type IsolationBlockReason =
  | "creation_failed"
  | "permission_denied"
  | "no_space"
  | "not_git_repo"
  | "branch_not_found"
  | "cross_clone"
  | "timeout"
  | "submodule_failed"
  | "unknown";

/**
 * Error thrown when isolation is required but cannot be provided.
 * Signals that execution should stop — the user has already been notified.
 */
export class IsolationBlockedError extends Error {
  readonly reason: IsolationBlockReason;

  constructor(message: string, reason: IsolationBlockReason) {
    super(message);
    this.name = "IsolationBlockedError";
    this.reason = reason;
  }
}

interface ErrorPattern {
  pattern: string;
  message: string;
  known: boolean;
  reason: IsolationBlockReason;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: "permission denied",
    message: "Permission denied while creating workspace. Check file system permissions.",
    known: true,
    reason: "permission_denied",
  },
  {
    pattern: "eacces",
    message: "Permission denied while creating workspace. Check file system permissions.",
    known: true,
    reason: "permission_denied",
  },
  {
    pattern: "timeout",
    message: "Timed out creating workspace. Git repository may be slow or unavailable.",
    known: true,
    reason: "timeout",
  },
  {
    pattern: "no space left",
    message: "No disk space available for new workspace.",
    known: true,
    reason: "no_space",
  },
  {
    pattern: "enospc",
    message: "No disk space available for new workspace.",
    known: true,
    reason: "no_space",
  },
  {
    pattern: "not a git repository",
    message: "Target path is not a valid git repository.",
    known: true,
    reason: "not_git_repo",
  },
  {
    pattern: "cannot extract owner/repo",
    message:
      "Repository path is too short to extract owner and repo name. " +
      "Re-register the codebase with a full path (e.g. `/home/user/owner/repo`).",
    known: false,
    reason: "unknown",
  },
  {
    pattern: "branch not found",
    message: "Branch not found. The requested branch may have been deleted or not yet pushed.",
    known: true,
    reason: "branch_not_found",
  },
  {
    pattern: "no base branch configured",
    message:
      "No base branch configured. Set `worktree.baseBranch` in `.gxpm/config.json` " +
      "or pass the branch explicitly.",
    known: true,
    reason: "branch_not_found",
  },
  {
    pattern: "belongs to a different clone",
    message:
      "A worktree at the target path was created by a different local clone. " +
      "Remove it from that clone, or register this codebase from the same local path.",
    known: true,
    reason: "cross_clone",
  },
  {
    pattern: "cannot verify worktree ownership",
    message:
      "Cannot verify ownership of an existing worktree at the target path. " +
      "Check file system permissions and remove any unrelated git directories at that path.",
    known: true,
    reason: "cross_clone",
  },
  {
    pattern: "cannot adopt",
    message:
      "Refused to adopt an existing directory at the worktree path. " +
      "Remove it or choose a different branch/codebase registration.",
    known: true,
    reason: "creation_failed",
  },
  {
    pattern: "submodule initialization failed",
    message:
      "Submodule initialization failed. Check credentials and network access to submodule remotes, " +
      "or disable submodule initialization if submodules are not needed.",
    known: true,
    reason: "submodule_failed",
  },
];

/**
 * Classify an isolation error into a user-friendly message.
 */
export function classifyIsolationError(err: Error): string {
  const stderr = (err as Error & { stderr?: string }).stderr ?? "";
  const errorLower = `${err.message} ${stderr}`.toLowerCase();

  for (const { pattern, message } of ERROR_PATTERNS) {
    if (errorLower.includes(pattern)) {
      return `Error: ${message}`;
    }
  }

  return `Error: Could not create isolated workspace (${err.message}).`;
}

/**
 * Returns true if the error is a known infrastructure failure that should
 * produce a user-facing "blocked" message rather than a crash.
 */
export function isKnownIsolationError(err: Error): boolean {
  const stderr = (err as Error & { stderr?: string }).stderr ?? "";
  const errorLower = `${err.message} ${stderr}`.toLowerCase();

  return ERROR_PATTERNS.some(({ pattern, known }) => known && errorLower.includes(pattern));
}

/**
 * Get the block reason for a known isolation error.
 */
export function getIsolationBlockReason(err: Error): IsolationBlockReason {
  const stderr = (err as Error & { stderr?: string }).stderr ?? "";
  const errorLower = `${err.message} ${stderr}`.toLowerCase();

  for (const { pattern, reason } of ERROR_PATTERNS) {
    if (errorLower.includes(pattern)) {
      return reason;
    }
  }
  return "unknown";
}
