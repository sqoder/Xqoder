// P17 — Skill module barrel.
export { parseSkillFrontmatter, asString, asStringArray, type FrontmatterValue, type ParsedFrontmatter } from './frontmatter.js';
export { loadSkillsDir, type SkillFile } from './load-dir.js';
export { detectSkillCandidates, type SkillCandidate, type DetectSkillOptions } from './activator.js';
export {
    loadSkillRegistry,
    resolveSkillSearchRoots,
    type SkillRegistry,
    type LoadSkillRegistryOptions,
} from './registry.js';
