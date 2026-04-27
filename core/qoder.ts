import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export const QODER_REPOWIKI_PATH = ".qoder/repowiki";
export const DEFAULT_SHARED_QODER_REPOWIKI = ".gxpm/local/qoder/repowiki";

export type QoderWikiLinkAction = "linked" | "already-linked" | "moved-and-linked" | "relinked";

export interface QoderWikiLinkResult {
  action: QoderWikiLinkAction;
  targetRoot: string;
  linkPath: string;
  sharedRoot: string;
}

export function ensureQoderWikiLink(input: {
  root?: string;
  target?: string;
  sharedRoot?: string;
  replace?: boolean;
} = {}): QoderWikiLinkResult {
  const root = resolve(input.root ?? process.cwd());
  const targetRoot = resolve(input.target ?? root);
  const sharedRoot = resolve(root, input.sharedRoot ?? DEFAULT_SHARED_QODER_REPOWIKI);
  const linkPath = join(targetRoot, QODER_REPOWIKI_PATH);
  const replace = input.replace ?? false;
  const current = safeLstat(linkPath);

  if (!current) {
    ensureSharedRoot(sharedRoot);
    createLink(linkPath, sharedRoot);
    return { action: "linked", targetRoot, linkPath, sharedRoot };
  }

  if (current.isSymbolicLink()) {
    const currentTarget = resolve(dirname(linkPath), readlinkSync(linkPath));
    if (currentTarget === sharedRoot) {
      ensureSharedRoot(sharedRoot);
      return { action: "already-linked", targetRoot, linkPath, sharedRoot };
    }
    if (!replace) {
      throw new Error(
        `refusing to replace ${QODER_REPOWIKI_PATH}; pass --replace to relink it`,
      );
    }
    rmSync(linkPath);
    ensureSharedRoot(sharedRoot);
    createLink(linkPath, sharedRoot);
    return { action: "relinked", targetRoot, linkPath, sharedRoot };
  }

  if (!replace) {
    throw new Error(
      `refusing to replace real ${QODER_REPOWIKI_PATH}; pass --replace to move it into the shared store`,
    );
  }

  if (existsSync(sharedRoot) && readdirSync(sharedRoot).length > 0) {
    throw new Error(`refusing to move ${QODER_REPOWIKI_PATH}; shared store is not empty: ${sharedRoot}`);
  }

  mkdirSync(dirname(sharedRoot), { recursive: true });
  if (existsSync(sharedRoot)) {
    rmSync(sharedRoot, { recursive: true, force: true });
  }
  renameSync(linkPath, sharedRoot);
  createLink(linkPath, sharedRoot);
  return { action: "moved-and-linked", targetRoot, linkPath, sharedRoot };
}

function safeLstat(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function ensureSharedRoot(sharedRoot: string) {
  mkdirSync(sharedRoot, { recursive: true });
}

function createLink(linkPath: string, sharedRoot: string) {
  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(sharedRoot, linkPath, "dir");
}
