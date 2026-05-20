import { resolve } from "node:path";
import { ARTIFACT_TYPES, type ArtifactType } from "../core/artifacts";
import { CAPABILITY_REGISTRY } from "../core/capabilities";
import { listValidatedArtifactTypes } from "../core/artifact-validator";
import { PHASE_GATE_RULES } from "../core/phase-gates";
import { ALL_HOST_CONFIGS } from "../hosts";
import { generateSkillDocs } from "./gen-skill-docs";
import { validateGovernanceDocs } from "./governance-check";
import { validateAllConfigs } from "./host-config";
import { validateSkillNaming } from "./skill-naming-check";
import { validateVersionTruth } from "./version";
import { validateSkillsLock } from "./skills-lock-check";
import { validateSkillStructure, formatSkillStructureErrors } from "./skill-structure-check";
import { validateSkillEval } from "./eval";

// Default to the gxpm repo itself (parent of scripts/) so the check is
// meaningful regardless of the cwd the CLI was invoked from.
const DEFAULT_GXPM_ROOT = resolve(import.meta.dir, "..");

export interface RunScaffoldCheckOptions {
  root?: string;
}

export function validateLayeredWorkflowContracts(): string[] {
  const errors: string[] = [];
  const artifactTypes = new Set<ArtifactType>(ARTIFACT_TYPES);
  const validatedArtifactTypes = new Set<ArtifactType>(listValidatedArtifactTypes());
  const capabilityArtifacts = new Set<ArtifactType>(
    CAPABILITY_REGISTRY.flatMap((capability) => capability.outputContract.artifacts),
  );

  for (const rule of PHASE_GATE_RULES) {
    if (!capabilityArtifacts.has(rule.requiredArtifact)) {
      errors.push(
        `phase gate ${rule.fromPhase}->${rule.nextPhase} requires ${rule.requiredArtifact}, but no capability outputs it`,
      );
    }
  }

  for (const artifactType of ARTIFACT_TYPES) {
    if (!validatedArtifactTypes.has(artifactType)) {
      errors.push(`artifact ${artifactType} is not covered by artifact-validator`);
    }
  }

  for (const artifactType of capabilityArtifacts) {
    if (!artifactTypes.has(artifactType)) {
      errors.push(`capability outputs unknown artifact ${artifactType}`);
    }
  }

  return errors;
}

export function runScaffoldCheck(options: RunScaffoldCheckOptions = {}) {
  const root = options.root ?? DEFAULT_GXPM_ROOT;

  const hostErrors = validateAllConfigs(ALL_HOST_CONFIGS);
  const governanceErrors = validateGovernanceDocs({ root });
  const versionErrors = validateVersionTruth({ root });
  const skillNamingErrors = validateSkillNaming({ root });
  const skillsLockErrors = validateSkillsLock({ root });
  const layeredWorkflowErrors = validateLayeredWorkflowContracts();
  const skillStructureViolations = validateSkillStructure(root);
  const { errors: skillStructureErrors, warnings: skillStructureWarnings } = formatSkillStructureErrors(skillStructureViolations);
  const skillEvalErrors = validateSkillEval({ root });
  const errors = [
    ...hostErrors.map((error) => `host config: ${error}`),
    ...governanceErrors.map((error) => `governance: ${error}`),
    ...versionErrors.map((error) => `version: ${error}`),
    ...skillNamingErrors.map((error) => `skill-naming: ${error}`),
    ...skillsLockErrors.map((error) => `skills-lock: ${error}`),
    ...layeredWorkflowErrors.map((error) => `layered-workflow: ${error}`),
    ...skillStructureErrors,
    ...skillEvalErrors.map((error) => `skill-eval: ${error}`),
  ];

  if (skillStructureWarnings.length > 0) {
    console.warn(skillStructureWarnings.join("\n"));
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  generateSkillDocs({ root, dryRun: true });
  return `gxpm scaffold check passed (${ALL_HOST_CONFIGS.length} hosts)`;
}
