import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export interface Skill {
  name: string;
  description: string;
  triggers: {
    taskKinds?: string[];
    roles?: string[];
    urlKeywords?: string[];
    domHints?: string[];
  };
  body: string;
  origin: 'built-in' | 'authored';
  path: string;
}

const BUILTIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'builtin');

/** Seed the global skill library with built-ins (never overwrites user edits). */
export async function seedGlobalSkills(globalSkillsDir: string): Promise<number> {
  await mkdir(globalSkillsDir, { recursive: true });
  let seeded = 0;
  for (const file of await readdir(BUILTIN_DIR)) {
    if (!file.endsWith('.md')) continue;
    const target = join(globalSkillsDir, file);
    if (!existsSync(target)) {
      await copyFile(join(BUILTIN_DIR, file), target);
      seeded++;
    }
  }
  return seeded;
}

/** Load skills from the global library + project overrides (project wins by name). */
export async function loadSkills(dirs: string[]): Promise<Skill[]> {
  const byName = new Map<string, Skill>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.md')) continue;
      const raw = await readFile(join(dir, file), 'utf8');
      const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!match) continue;
      const front = parseYaml(match[1]!) as {
        name?: string;
        description?: string;
        triggers?: Skill['triggers'];
        origin?: string;
      };
      if (!front.name) continue;
      byName.set(front.name, {
        name: front.name,
        description: front.description ?? '',
        triggers: front.triggers ?? {},
        body: match[2]!.trim(),
        origin: front.origin === 'authored' ? 'authored' : 'built-in',
        path: join(dir, file),
      });
    }
  }
  return [...byName.values()];
}

export interface SkillContext {
  taskKind: string;
  roles?: string[];
  urls?: string[];
  domHints?: string[];
}

/** Rank skills by trigger overlap with the current context. */
export function matchSkills(skills: Skill[], ctx: SkillContext, limit = 4): Skill[] {
  const roles = new Set((ctx.roles ?? []).map((r) => r.toLowerCase()));
  const urls = (ctx.urls ?? []).map((u) => u.toLowerCase());
  const hints = new Set((ctx.domHints ?? []).map((h) => h.toLowerCase()));
  return skills
    .map((skill) => {
      let score = 0;
      const t = skill.triggers;
      if (t.taskKinds?.includes(ctx.taskKind)) score += 1;
      else if (t.taskKinds && t.taskKinds.length > 0) return { skill, score: -1 }; // wrong task kind
      score += (t.roles ?? []).filter((r) => roles.has(r.toLowerCase())).length;
      score += (t.urlKeywords ?? []).filter((k) => urls.some((u) => u.includes(k.toLowerCase()))).length;
      score += (t.domHints ?? []).filter((h) => hints.has(h.toLowerCase())).length;
      return { skill, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.skill);
}

/** Render matched skills as a prompt section; empty string when none. */
export function renderSkillsSection(skills: Skill[]): string {
  if (skills.length === 0) return '';
  return [
    '## Relevant testing skills (proven playbooks — follow them where applicable)',
    ...skills.map((s) => `### ${s.name}\n${s.body}`),
  ].join('\n\n');
}
