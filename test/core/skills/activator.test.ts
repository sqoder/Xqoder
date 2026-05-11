import { describe, expect, it } from 'bun:test';
import {
    detectSkillCandidates,
    type SkillCandidate,
} from '../../../src/core/skills/activator.js';
import type { SkillFile } from '../../../src/core/skills/load-dir.js';

function skill(partial: Partial<SkillFile> & { name: string }): SkillFile {
    return {
        name: partial.name,
        description: partial.description ?? '',
        triggers: partial.triggers ?? [],
        tools: partial.tools ?? [],
        filePath: partial.filePath ?? `/virtual/${partial.name}.md`,
        body: partial.body ?? 'body',
    };
}

describe('detectSkillCandidates', () => {
    const registry: SkillFile[] = [
        skill({
            name: 'brand-voice',
            description: 'Writing in the company tone',
            triggers: ['brand', 'tone', 'voice'],
        }),
        skill({
            name: 'make-pdf',
            description: 'Generate publication-quality PDF documents',
            triggers: ['pdf', 'export'],
        }),
        skill({
            name: 'qa',
            description: 'Systematically QA test a web application',
            triggers: ['qa', 'browser', 'playwright'],
        }),
        skill({
            name: 'gstack',
            description: 'Browser automation for QA',
            triggers: ['browser', 'headless'],
        }),
    ];

    it('returns empty when prompt has no matches', () => {
        const result = detectSkillCandidates('hello world', registry);
        expect(result).toEqual([]);
    });

    it('ranks trigger matches higher than description matches', () => {
        const result = detectSkillCandidates('please export a pdf report', registry);
        expect(result[0]!.skill.name).toBe('make-pdf');
    });

    it('matches name appearance in the prompt', () => {
        const result = detectSkillCandidates('run the gstack flow', registry);
        expect(result[0]!.skill.name).toBe('gstack');
    });

    it('is case-insensitive for triggers', () => {
        const result = detectSkillCandidates('BROWSER qa smoke', registry);
        const names = result.map((c: SkillCandidate) => c.skill.name);
        expect(names).toContain('qa');
        expect(names).toContain('gstack');
    });

    it('caps by topN', () => {
        const result = detectSkillCandidates('brand pdf qa browser', registry, { topN: 2 });
        expect(result.length).toBe(2);
    });

    it('attaches matched triggers to candidate for explainability', () => {
        const result = detectSkillCandidates('brand and tone matter', registry);
        const brand = result.find((c) => c.skill.name === 'brand-voice');
        expect(brand).toBeDefined();
        expect(brand!.matchedTriggers.sort()).toEqual(['brand', 'tone']);
    });
});
