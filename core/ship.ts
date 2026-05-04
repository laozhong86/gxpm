import { createPhaseArtifactInitializer } from "./phase-artifact";

export const initializeShipReadiness = createPhaseArtifactInitializer({
  artifactType: "ship-readiness",
  label: "Ship readiness",
  payload: {
    checklist: [],
    compatibilityMigration: {
      backwardCompatible: true,
      configChanges: false,
      migrationSteps: "",
    },
    blastRadius: {
      affectedSubsystems: [],
      guardrails: "",
      unintendedEffects: "",
    },
    humanVerification: {
      edgeCases: "",
      notVerified: "",
      verifiedScenarios: "",
    },
    releaseNotes: "",
    reviewedArtifacts: ["self-review", "acceptance-check"],
    risks: [],
    risksAndMitigations: [],
    rollbackPlan: {
      failureSymptoms: "",
      featureFlags: "",
      rollbackCommand: "",
    },
    securityImpact: {
      fileSystemAccessChanged: false,
      networkCallsChanged: false,
      newPermissionsOrCapabilities: false,
      riskAndMitigation: "",
      secretsHandlingChanged: false,
    },
    status: "draft",
    summary: "",
    targetBranch: "",
  },
  requiredPhase: "self-review",
});
