import { describe, expect, it } from 'bun:test';
import { parseSkillFrontmatter } from '../../../src/core/skills/frontmatter.js';

describe('parseSkillFrontmatter', () => {
    it('parses inline scalar fields', () => {
        const raw = `---
name: qa
description: QA a web application
---
Body text.`;
        const parsed = parseSkillFrontmatter(raw);
        expect(parsed.metadata.name).toBe('qa');
        expect(parsed.metadata.description).toBe('QA a web application');
        expect(parsed.body.trim()).toBe('Body text.');
    });

    it('parses block list for triggers and tools', () => {
        const raw = `---
name: brand-voice
description: Writing tone
triggers:
  - brand
  - tone
  - style
tools:
  - read_file
  - edit_file
---

Body.`;
        const parsed = parseSkillFrontmatter(raw);
        expect(parsed.metadata.triggers).toEqual(['brand', 'tone', 'style']);
        expect(parsed.metadata.tools).toEqual(['read_file', 'edit_file']);
    });

    it('parses inline array syntax for triggers', () => {
        const raw = `---
name: gstack
description: Browser QA
triggers: [browser, qa, playwright]
---
Body.`;
        const parsed = parseSkillFrontmatter(raw);
        expect(parsed.metadata.triggers).toEqual(['browser', 'qa', 'playwright']);
    });

    it('returns body when no frontmatter is present', () => {
        const raw = 'Just a body without header.';
        const parsed = parseSkillFrontmatter(raw);
        expect(parsed.metadata).toEqual({});
        expect(parsed.body).toBe(raw);
    });

    it('strips wrapping quotes from scalars', () => {
        const raw = `---
name: "make-pdf"
description: 'PDF generation'
---
Body.`;
        const parsed = parseSkillFrontmatter(raw);
        expect(parsed.metadata.name).toBe('make-pdf');
        expect(parsed.metadata.description).toBe('PDF generation');
    });
});
