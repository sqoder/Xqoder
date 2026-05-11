// P17 — Skill activator.
//
// Given a user prompt + a registry of skills, returns the top-N candidates
// the model might want to activate this turn. Scoring is deliberately
// simple and explainable; fancier vector-style matching would require
// shipping a model inline and is explicit non-goals for this phase.
//
// Signal weights (higher is better):
//   - skill.name appears in prompt   → +5
//   - each trigger in prompt         → +3
//   - each meaningful description    → +1
//     word (>3 chars) in prompt
//
// We lowercase both sides and look for whole-word matches to avoid
// "pdf" triggering on "upd**pdf**ate". Matched triggers are returned so the
// SkillTool description can explain *why* a skill was suggested.

import type { SkillFile } from './load-dir.js';

export interface SkillCandidate {
    readonly skill: SkillFile;
    readonly score: number;
    readonly matchedTriggers: readonly string[];
}

export interface DetectSkillOptions {
    readonly topN?: number;
}

const DEFAULT_TOP_N = 5;
const MIN_DESCRIPTION_WORD_LENGTH = 4;

export function detectSkillCandidates(
    prompt: string,
    registry: readonly SkillFile[],
    options: DetectSkillOptions = {},
): SkillCandidate[] {
    const topN = options.topN ?? DEFAULT_TOP_N;
    const tokens = tokenize(prompt);
    if (tokens.size === 0 || registry.length === 0) {
        return [];
    }

    const scored: SkillCandidate[] = [];
    for (const skill of registry) {
        const matchedTriggers: string[] = [];
        let score = 0;

        if (tokens.has(skill.name.toLowerCase())) {
            score += 5;
        }

        for (const trigger of skill.triggers) {
            if (tokens.has(trigger.toLowerCase())) {
                score += 3;
                matchedTriggers.push(trigger);
            }
        }

        for (const word of tokenize(skill.description)) {
            if (word.length < MIN_DESCRIPTION_WORD_LENGTH) continue;
            if (tokens.has(word)) {
                score += 1;
            }
        }

        if (score > 0) {
            scored.push({ skill, score, matchedTriggers });
        }
    }

    scored.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
    return scored.slice(0, topN);
}

function tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    for (const raw of text.toLowerCase().split(/[^a-z0-9_-]+/)) {
        if (raw) tokens.add(raw);
    }
    return tokens;
}
