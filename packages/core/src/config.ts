import { z } from 'zod';

export const engineIdSchema = z.enum(['copilot-cli', 'claude-agent-sdk', 'claude-cli', 'replay']);
export type EngineId = z.infer<typeof engineIdSchema>;

export const authConfigSchema = z.object({
  /** URL of the login page; explorer performs a scripted login before crawling. */
  loginUrl: z.string().url().optional(),
  /** Selector/value steps executed in order. Values may reference env vars as $ENV_NAME. */
  steps: z
    .array(
      z.object({
        action: z.enum(['fill', 'click', 'waitForURL']),
        selector: z.string().optional(),
        value: z.string().optional(),
      }),
    )
    .default([]),
});

export const budgetsSchema = z.object({
  maxStates: z.number().int().positive().default(50),
  maxActions: z.number().int().positive().default(300),
  wallClockMs: z
    .number()
    .int()
    .positive()
    .default(10 * 60 * 1000),
});

export const DEFAULT_DENY_LEXICON = [
  'delete',
  'remove',
  'destroy',
  'pay',
  'purchase',
  'checkout',
  'send',
  'publish',
  'deactivate',
  'logout',
  'log out',
  'sign out',
  'unsubscribe',
  'transfer',
];

export const taConfigSchema = z.object({
  /** Human-readable project name. */
  name: z.string().min(1),
  /** Base URL of the target app. */
  baseUrl: z.string().url(),
  /** Optional path to the target app's source repo for static analysis. */
  sourceRoot: z.string().optional(),
  /** Optional BRD/PRD documents. */
  requirements: z.array(z.string()).default([]),
  /** Optional design inputs: figma file key or folder of screenshots. */
  design: z
    .object({
      figmaFileKey: z.string().optional(),
      screenshotsDir: z.string().optional(),
    })
    .default({}),
  engine: engineIdSchema.default('copilot-cli'),
  /** Engine used for vision tasks when the primary engine lacks vision. */
  visionFallbackEngine: engineIdSchema.optional(),
  model: z.string().optional(),
  auth: authConfigSchema.optional(),
  budgets: budgetsSchema.default({}),
  /** Accessible names matching any of these words are treated as destructive. */
  denyLexicon: z.array(z.string()).default(DEFAULT_DENY_LEXICON),
  /** Hosts the explorer may talk to besides the target origin. */
  allowedHosts: z.array(z.string()).default([]),
  /** Deterministic faker seed for reproducible form data. */
  fakerSeed: z.number().int().default(42),
});

export type TaConfig = z.infer<typeof taConfigSchema>;
export type TaConfigInput = z.input<typeof taConfigSchema>;

/** Identity helper for ta.config.ts files: `export default defineConfig({...})`. */
export function defineConfig(config: TaConfigInput): TaConfigInput {
  return config;
}

export function parseConfig(raw: unknown): TaConfig {
  return taConfigSchema.parse(raw);
}
