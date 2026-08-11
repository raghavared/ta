import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractAndValidate } from './json-extract.js';

const schema = z.object({ answer: z.string(), score: z.number() });
type Result = z.infer<typeof schema>;

describe('extractAndValidate', () => {
  it('parses a bare JSON object', () => {
    const r = extractAndValidate<Result>('{"answer":"yes","score":1}', schema);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ answer: 'yes', score: 1 });
  });

  it('parses JSON inside a fenced block with surrounding prose', () => {
    const raw = 'Here you go:\n```json\n{"answer":"ok","score":2}\n```\nDone.';
    const r = extractAndValidate<Result>(raw, schema);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ answer: 'ok', score: 2 });
  });

  it('takes the last JSON object when several appear', () => {
    const raw = '{"answer":"draft","score":0} ... final: {"answer":"final","score":3}';
    const r = extractAndValidate<Result>(raw, schema);
    expect(r.ok).toBe(true);
    expect(r.data?.answer).toBe('final');
  });

  it('handles braces inside strings', () => {
    const raw = '{"answer":"curly } brace { text","score":4}';
    const r = extractAndValidate<Result>(raw, schema);
    expect(r.ok).toBe(true);
    expect(r.data?.answer).toContain('curly');
  });

  it('reports schema violations with paths', () => {
    const r = extractAndValidate<Result>('{"answer":42,"score":"high"}', schema);
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('answer');
    expect(r.issues).toContain('score');
  });

  it('fails cleanly when no JSON present', () => {
    const r = extractAndValidate<Result>('I cannot help with that.', schema);
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('No JSON');
  });
});
