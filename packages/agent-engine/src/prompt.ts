import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AgentTaskSpec } from './engine.js';

/** Render a task into a single self-contained prompt (works for every engine). */
export function renderPrompt(task: AgentTaskSpec): string {
  const jsonSchema = JSON.stringify(zodToJsonSchema(task.schema, 'Result'), null, 2);
  return [
    `# Task: ${task.kind}`,
    '',
    task.system.trim(),
    '',
    '## Context',
    '```json',
    JSON.stringify(task.context, null, 2),
    '```',
    '',
    '## Output contract',
    'Respond with ONLY a single JSON object matching this JSON Schema. No prose, no markdown fences, no explanation.',
    '```json',
    jsonSchema,
    '```',
  ].join('\n');
}

/** Render the repair prompt after a validation failure. */
export function renderRepairPrompt(issues: string, previousRaw: string): string {
  return [
    'Your previous output failed schema validation.',
    '',
    '## Validation errors',
    issues,
    '',
    '## Your previous output',
    previousRaw.slice(0, 4000),
    '',
    'Resend ONLY the corrected JSON object. No prose.',
  ].join('\n');
}
