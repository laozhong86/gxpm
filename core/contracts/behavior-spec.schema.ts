import { z } from "zod";

const ScenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  given: z.array(z.string().min(1)).min(1),
  when: z.string().min(1),
  then: z.array(z.string().min(1)).min(1),
  examples: z.array(z.record(z.string(), z.unknown())).default([]),
  stubPath: z.string().min(1),
});

const FeatureSchema = z.object({
  title: z.string().min(1),
  asA: z.string().min(1),
  iWant: z.string().min(1),
  soThat: z.string().min(1),
});

export const BehaviorSpecSchema = z.object({
  $schema: z.literal("behavior-spec.v1"),
  issueId: z.string().min(1),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
  confirmedAt: z.string().datetime().nullable(),
  confirmedBy: z.string().nullable(),
  feature: FeatureSchema,
  scenarios: z.array(ScenarioSchema).min(1),
  guidelinesRef: z.string().min(1),
}).refine(
  (spec) =>
    (spec.confirmedAt === null && spec.confirmedBy === null) ||
    (spec.confirmedAt !== null && spec.confirmedBy !== null),
  { message: "confirmedAt and confirmedBy must both be null or both be set" },
);

export type BehaviorSpec = z.infer<typeof BehaviorSpecSchema>;
export type BehaviorSpecScenario = z.infer<typeof ScenarioSchema>;
