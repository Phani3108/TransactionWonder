// file: src/skills/registry.ts
// description: In-memory registry of skill definitions.
// reference: src/skills/types.ts, src/skills/executor.ts

import type { SkillDefinition } from './types';

const skills = new Map<string, SkillDefinition<any, any>>();

/** Register a skill. Idempotent on the same (name, definition) pair. */
export function registerSkill(skill: SkillDefinition<any, any>): void {
  const existing = skills.get(skill.name);
  if (existing && existing !== skill) {
    throw new Error(`Skill already registered under a different definition: ${skill.name}`);
  }
  skills.set(skill.name, skill);
}

/** Retrieve a skill by name, or null if not registered. */
export function getSkill(name: string): SkillDefinition<any, any> | null {
  return skills.get(name) ?? null;
}

/** List all registered skill names (for diagnostics + UI). */
export function listSkills(): string[] {
  return Array.from(skills.keys()).sort();
}

/** Test-only: clear the registry. Do not call in production paths. */
export function _resetRegistry(): void {
  skills.clear();
}
