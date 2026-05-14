import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export type ProjectInitializationKind = "uninitialized" | "partial" | "initialized";

export interface ProjectInitializationStatus {
  kind: ProjectInitializationKind;
  cwd: string | null;
  missingMarkers: string[];
  presentMarkers: string[];
}

export const REQUIRED_GXPM_DIRS = [
  ".gxpm/issues",
  ".gxpm/local",
  ".gxpm/out-of-scope",
  ".gxpm/wiki",
];

export const REQUIRED_GXPM_FILES = [
  ".gxpm/config.json",
];

export const REQUIRED_GXPM_GIT_HOOKS = [
  "gxpm-pre-commit",
  "gxpm-commit-msg",
  "gxpm-pre-push",
  "gxpm-post-merge",
  "gxpm-post-checkout",
];

export function getProjectInitializationStatus(cwd: string | null | undefined): ProjectInitializationStatus {
  if (!cwd) {
    return {
      kind: "uninitialized",
      cwd: null,
      missingMarkers: ["cwd"],
      presentMarkers: [],
    };
  }

  const presentMarkers: string[] = [];
  const missingMarkers: string[] = [];
  const gxpmRootExists = isDirectory(join(cwd, ".gxpm"));

  if (!gxpmRootExists) {
    return {
      kind: "uninitialized",
      cwd,
      missingMarkers: [".gxpm", ...REQUIRED_GXPM_DIRS, ...REQUIRED_GXPM_FILES],
      presentMarkers,
    };
  }
  presentMarkers.push(".gxpm");

  for (const dir of REQUIRED_GXPM_DIRS) {
    if (isDirectory(join(cwd, dir))) {
      presentMarkers.push(dir);
    } else {
      missingMarkers.push(dir);
    }
  }

  for (const file of REQUIRED_GXPM_FILES) {
    if (isFile(join(cwd, file))) {
      presentMarkers.push(file);
    } else {
      missingMarkers.push(file);
    }
  }

  if (hasGitMetadata(cwd)) {
    for (const hook of REQUIRED_GXPM_GIT_HOOKS) {
      const marker = `.githooks/${hook}`;
      if (isFile(join(cwd, marker))) {
        presentMarkers.push(marker);
      } else {
        missingMarkers.push(marker);
      }
    }
  }

  return {
    kind: missingMarkers.length === 0 ? "initialized" : "partial",
    cwd,
    missingMarkers,
    presentMarkers,
  };
}

export function formatProjectInitializationContext(status: ProjectInitializationStatus): string | null {
  if (status.kind === "initialized") return null;

  const missing = status.missingMarkers.slice(0, 8).join(", ");
  const suffix = status.missingMarkers.length > 8 ? ", ..." : "";
  const state =
    status.kind === "uninitialized"
      ? "gxpm hooks are active, but this repository has not been initialized"
      : "gxpm initialization is incomplete";

  return [
    `${state}.`,
    `Missing: ${missing}${suffix}.`,
    "Run `gxpm init --target <repo>` or `gxpm doctor --fix` after reviewing existing repo hooks.",
    "Until initialization is complete, gxpm hooks will not write plan state.",
  ].join(" ");
}

function hasGitMetadata(cwd: string): boolean {
  return existsSync(join(cwd, ".git"));
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
