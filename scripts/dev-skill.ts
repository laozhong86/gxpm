import { existsSync, watch } from "node:fs";
import { join, relative, resolve } from "node:path";
import { discoverTemplates } from "./discover-skills";
import { generateSkillDocs } from "./gen-skill-docs";

const ROOT = resolve(import.meta.dir, "..");
const templates = discoverTemplates(ROOT).filter((template) => template.tmpl === "skills/gxpm/SKILL.md.tmpl");

if (templates.length === 0) {
  console.error("[dev:skill] no gxpm skill template found");
  process.exit(1);
}

let running = false;
let queued = false;

function regenerateAndValidate() {
  if (running) {
    queued = true;
    return;
  }

  running = true;
  try {
    const generated = generateSkillDocs({ root: ROOT });
    console.log(`[gen] ${generated.length > 0 ? generated.join(", ") : "skill docs are current"}`);
    generateSkillDocs({ root: ROOT, dryRun: true });
    console.log("[check] generated skill docs are current");
  } catch (error) {
    console.log(`[error] ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    running = false;
    if (queued) {
      queued = false;
      regenerateAndValidate();
    }
  }
}

console.log("[watch] watching skills/gxpm/SKILL.md.tmpl");
regenerateAndValidate();

for (const template of templates) {
  const path = join(ROOT, template.tmpl);
  if (!existsSync(path)) continue;
  watch(path, { persistent: true }, () => {
    console.log(`[watch] ${relative(ROOT, path)} changed`);
    regenerateAndValidate();
  });
}

console.log("[watch] press Ctrl+C to stop");
setInterval(() => {}, 60_000);
