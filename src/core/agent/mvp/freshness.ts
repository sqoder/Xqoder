import type { MvpContextSection, MvpContextTier } from './types.js';

const WEIGHTS = {
    relevance: 0.4,
    recency: 0.3,
    references: 0.2,
    tier: 0.1,
} as const;

const DEFAULT_HALF_LIFE_MS = 5 * 60 * 1000;

const TIER_BASE: Record<MvpContextTier, number> = {
    Goal: 1,
    Error: 0.95,
    Active: 0.8,
    History: 0.5,
    Background: 0.2,
};

const TIER_PRIORITY: Record<MvpContextTier, number> = {
    Goal: 5,
    Error: 4,
    Active: 3,
    History: 2,
    Background: 1,
};

export function calculateMvpFreshness(
    section: MvpContextSection,
    nowMs: number = Date.now(),
    halfLifeMs: number = DEFAULT_HALF_LIFE_MS,
): number {
    const lastUpdatedAt = section.updatedAtMs ?? nowMs;
    const ageMs = Math.max(0, nowMs - lastUpdatedAt);
    const recencyScore = Math.exp(-ageMs / halfLifeMs);
    const referenceScore = Math.min(1, Math.log1p(section.referenceCount) / Math.log1p(10));
    const rawScore = (
        section.relevanceScore * WEIGHTS.relevance
        + recencyScore * WEIGHTS.recency
        + referenceScore * WEIGHTS.references
        + TIER_BASE[section.tier] * WEIGHTS.tier
    );

    if (section.tier === 'Goal' || section.tier === 'Error') {
        return Math.max(rawScore, 0.95);
    }

    return Math.min(1, rawScore);
}

export function scoreMvpContextSections(
    sections: MvpContextSection[],
    nowMs: number = Date.now(),
): MvpContextSection[] {
    return sections.map((section) => ({
        ...section,
        freshnessScore: calculateMvpFreshness(section, nowMs),
    }));
}

export function orderMvpContextSections(
    sections: MvpContextSection[],
    nowMs: number = Date.now(),
): MvpContextSection[] {
    return scoreMvpContextSections(sections, nowMs)
        .sort((left, right) => {
            const freshnessDelta = (right.freshnessScore ?? 0) - (left.freshnessScore ?? 0);
            if (freshnessDelta !== 0) {
                return freshnessDelta;
            }

            const tierDelta = TIER_PRIORITY[right.tier] - TIER_PRIORITY[left.tier];
            if (tierDelta !== 0) {
                return tierDelta;
            }

            return right.relevanceScore - left.relevanceScore;
        });
}

export function sortMvpSectionsForCompression(
    sections: MvpContextSection[],
    nowMs: number = Date.now(),
): MvpContextSection[] {
    return scoreMvpContextSections(sections, nowMs)
        .sort((left, right) => {
            const freshnessDelta = (left.freshnessScore ?? 0) - (right.freshnessScore ?? 0);
            if (freshnessDelta !== 0) {
                return freshnessDelta;
            }

            return TIER_PRIORITY[left.tier] - TIER_PRIORITY[right.tier];
        });
}
