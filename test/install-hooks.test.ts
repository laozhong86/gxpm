import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const installScript = resolve(import.meta.dir, "..", "scripts", "install-hooks.ts");

function bunRun(args: string[], cwd: string) {
  return Bun.spawnSync({
    cmd: ["bun", "run", installScript, ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("install-hooks", () => {
  test("installs gxpm hook files into target repo's .githooks/", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-install-target-"));
    execSync("git init -q", { cwd: repo });

    const r = bunRun(["--target", repo], repo);
    expect(r.exitCode).toBe(0);

    expect(existsSync(join(repo, ".githooks", "gxpm-pre-commit"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "gxpm-commit-msg"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "gxpm-pre-push"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "gxpm-post-merge"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "gxpm-post-checkout"))).toBe(true);
    const preCommit = readFileSync(join(repo, ".githooks", "gxpm-pre-commit"), "utf8");
    expect(preCommit).toContain("gate branch-policy");
    expect(preCommit).toContain("git diff --cached --name-only --diff-filter=ACMR -z");
    expect(preCommit).toContain('"${staged_files[@]}"');
    const postCheckout = readFileSync(join(repo, ".githooks", "gxpm-post-checkout"), "utf8");
    expect(postCheckout).toContain("gate branch-policy");
    const postMerge = readFileSync(join(repo, ".githooks", "gxpm-post-merge"), "utf8");
    expect(postMerge).toContain('gxpm gate post-merge "$issue_id" || true');
    expect(postMerge).toContain("post-merge-reconcile");
    expect(postMerge).toContain("post-merge-error.log");
  });

  test("sets git core.hooksPath to absolute .githooks path", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-install-hookspath-"));
    execSync("git init -q", { cwd: repo });

    bunRun(["--target", repo], repo);

    const hooksPath = execSync("git config core.hooksPath", { cwd: repo }).toString().trim();
    expect(hooksPath).toBe(join(resolve(repo), ".githooks"));
  });

  test("does not overwrite existing .githooks/pre-commit", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-install-noclobber-"));
    execSync("git init -q", { cwd: repo });
    mkdirSync(join(repo, ".githooks"), { recursive: true });
    writeFileSync(join(repo, ".githooks", "pre-commit"), "#existing\n");

    bunRun(["--target", repo], repo);

    const content = readFileSync(join(repo, ".githooks", "pre-commit"), "utf8");
    expect(content).toContain("#existing");
  });

  test("fails when target is not a git repo", () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "gxpm-install-not-repo-"));
    const r = bunRun(["--target", nonRepo], nonRepo);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("Not a git repository");
  });

  test("creates top-level dispatcher hooks when none exist", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-install-dispatcher-"));
    execSync("git init -q", { cwd: repo });

    const r = bunRun(["--target", repo], repo);
    expect(r.exitCode).toBe(0);

    expect(existsSync(join(repo, ".githooks", "pre-commit"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "commit-msg"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "pre-push"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "post-merge"))).toBe(true);
    expect(existsSync(join(repo, ".githooks", "post-checkout"))).toBe(true);

    const preCommit = readFileSync(join(repo, ".githooks", "pre-commit"), "utf8");
    expect(preCommit).toContain("gxpm-pre-commit");
    const postCheckout = readFileSync(join(repo, ".githooks", "post-checkout"), "utf8");
    expect(postCheckout).toContain("gxpm-post-checkout");
  });
});

// ---------------------------------------------------------------------------
// GXPM-193: nexus npm script injection
//
// Feature: gxpm-init 在接入仓库时注入 nexus npm 脚本
//
// As a 在新仓库接入 gxpm 的工程师
// I want 运行 gxpm-init --install-hooks 时自动获得 nexus 与 nexus:full 两条 npm 脚本入口
// So that GitNexus 索引可以走统一入口，不再修改受版本管理的 AGENTS.md 与 CLAUDE.md 区块
//
// Spec: .gxpm/issues/GXPM-193/artifacts/behavior-spec.json
// ---------------------------------------------------------------------------

describe("install-hooks: nexus script injection (GXPM-193)", () => {
  // Scenario (scn-01): 首次接入仓库注入 nexus 与 nexus:full 脚本
  //   Given 目标仓库根目录存在一个已初始化的 package.json，且其 scripts 区块不包含名为 nexus 或 nexus:full 的脚本
  //   And 目标仓库已是 git 仓库
  //   When 工程师在该仓库执行 gxpm-init --install-hooks
  //   Then package.json 的 scripts 区块新增 nexus，其值精确等于字符串 gitnexus analyze --skip-agents-md
  //   And package.json 的 scripts 区块新增 nexus:full，其值精确等于字符串 gitnexus analyze
  //   And package.json 其余字段与原有顺序保持不变
  test("test_inject_nexus_scripts_on_first_install", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-nexus-first-"));
    execSync("git init -q", { cwd: repo });
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ name: "demo", version: "0.0.0", scripts: { build: "echo build" } }, null, 2) + "\n",
    );

    const r = bunRun(["--target", repo], repo);
    expect(r.exitCode).toBe(0);

    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    expect(pkg.scripts.nexus).toBe("gitnexus analyze --skip-agents-md");
    expect(pkg.scripts["nexus:full"]).toBe("gitnexus analyze");
    expect(pkg.scripts.build).toBe("echo build");
    expect(pkg.name).toBe("demo");
    expect(pkg.version).toBe("0.0.0");
  });

  // Scenario (scn-02): 重复执行保持幂等
  //   Given 目标仓库 package.json 的 scripts 区块已经被 gxpm-init 注入过 nexus 与 nexus:full 两条脚本
  //   And 工程师上一次注入完成后未手工编辑 package.json
  //   When 工程师再次执行 gxpm-init --install-hooks
  //   Then package.json 的内容与上一次注入完成时字节级一致
  //   And 目标仓库的命令输出不报告新的注入动作
  test("test_repeat_install_is_idempotent", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-nexus-idem-"));
    execSync("git init -q", { cwd: repo });
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ name: "demo", version: "0.0.0", scripts: { build: "echo build" } }, null, 2) + "\n",
    );

    bunRun(["--target", repo], repo);
    const afterFirst = readFileSync(join(repo, "package.json"), "utf8");

    bunRun(["--target", repo], repo);
    const afterSecond = readFileSync(join(repo, "package.json"), "utf8");

    expect(afterSecond).toBe(afterFirst);
  });

  // Scenario (scn-03): 尊重用户已有的同名脚本不覆盖
  //   Given 目标仓库 package.json 的 scripts 区块已经有一条名为 nexus 的脚本，其值是工程师自定义的命令
  //   When 工程师执行 gxpm-init --install-hooks
  //   Then package.json 中原有的 nexus 脚本值保持不变
  //   And 命令输出明确告知 nexus 脚本已存在被跳过
  //   And 其余安装步骤继续完成
  test("test_existing_nexus_script_is_not_overwritten", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-nexus-existing-"));
    execSync("git init -q", { cwd: repo });
    const customNexus = "my-custom-indexer --quiet";
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify(
        { name: "demo", version: "0.0.0", scripts: { build: "echo build", nexus: customNexus } },
        null,
        2,
      ) + "\n",
    );

    const r = bunRun(["--target", repo], repo);
    expect(r.exitCode).toBe(0);

    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    expect(pkg.scripts.nexus).toBe(customNexus);
    const stdout = r.stdout.toString();
    expect(stdout).toContain("skipped nexus script: already exists");
  });

  // Scenario (scn-04): 通过 skip 开关全程不动 package.json
  //   Given 目标仓库 package.json 的 scripts 区块不包含 nexus 或 nexus:full
  //   When 工程师执行 gxpm-init --install-hooks --skip-nexus-script
  //   Then package.json 的内容与执行前字节级一致
  //   And 命令输出不包含注入或跳过 nexus 脚本的提示
  //   And 其余安装步骤照常完成
  test("test_skip_nexus_script_flag_leaves_package_json_untouched", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-nexus-skip-"));
    execSync("git init -q", { cwd: repo });
    const original = JSON.stringify({ name: "demo", version: "0.0.0", scripts: { build: "echo build" } }, null, 2) + "\n";
    writeFileSync(join(repo, "package.json"), original);

    const r = bunRun(["--target", repo, "--skip-nexus-script"], repo);
    expect(r.exitCode).toBe(0);

    expect(readFileSync(join(repo, "package.json"), "utf8")).toBe(original);
    const stdout = r.stdout.toString();
    expect(stdout).not.toContain("installed nexus scripts");
    expect(stdout).not.toContain("skipped nexus script");
  });

  // Scenario (scn-05): 无 package.json 的仓库静默通过
  //   Given 目标仓库是一个 git 仓库
  //   And 目标仓库根目录不存在 package.json
  //   When 工程师执行 gxpm-init --install-hooks
  //   Then 命令不创建 package.json
  //   And 命令以零退出码完成
  //   And 命令输出不报告与 nexus 脚本相关的错误或警告
  test("test_missing_package_json_passes_silently", () => {
    const repo = mkdtempSync(join(tmpdir(), "gxpm-no-pkg-"));
    execSync("git init -q", { cwd: repo });

    const r = bunRun(["--target", repo], repo);
    expect(r.exitCode).toBe(0);

    expect(existsSync(join(repo, "package.json"))).toBe(false);
    const stdout = r.stdout.toString();
    const stderr = r.stderr.toString();
    expect(stdout).not.toContain("installed nexus scripts");
    expect(stdout).not.toContain("skipped nexus script");
    expect(stderr).not.toContain("nexus");
  });
});
