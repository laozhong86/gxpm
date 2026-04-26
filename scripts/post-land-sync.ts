import { join, resolve } from "node:path";

interface PostLandSkillSyncOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
}

interface PostLandSkillSyncResult {
  ok: boolean;
  message: string;
}

const DEFAULT_GXPM_ROOT = resolve(import.meta.dir, "..");

export function runPostLandSkillSync(options: PostLandSkillSyncOptions = {}): PostLandSkillSyncResult {
  const root = options.root ?? DEFAULT_GXPM_ROOT;
  const env = options.env ?? process.env;
  if (env.GXPM_SKIP_POST_LAND_SYNC === "1") {
    return { ok: true, message: "post-land skill install skipped" };
  }
  const gxpmInit = env.GXPM_INIT_BIN || join(root, "bin", "gxpm-init");

  try {
    const result = Bun.spawnSync({
      cmd: [gxpmInit, "--install-skill", "--host", "all"],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    if (result.exitCode === 0) {
      return { ok: true, message: "skill install sync completed" };
    }

    const stderr = result.stderr.toString().trim();
    const stdout = result.stdout.toString().trim();
    const detail = stderr || stdout || `exit code ${result.exitCode}`;
    return { ok: false, message: `post-land skill install failed: ${detail}` };
  } catch (error) {
    return {
      ok: false,
      message: `post-land skill install failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
