import { resolveOverlayHitTestItemCount } from './overlay-hit-test.js';

function asOverlayLayoutSource(
    overlay: unknown,
): { items?: unknown[]; maxWidth?: number | null; max_width?: number | null } | null {
    if (!overlay || typeof overlay !== 'object') {
        return null;
    }
    return overlay as { items?: unknown[]; maxWidth?: number | null; max_width?: number | null };
}

export function resolveOverlayLayoutProps(
    overlay: unknown,
    minimumItemCount = 0,
): { itemCount: number; maxWidth: number | null } {
    const source = asOverlayLayoutSource(overlay);
    const itemCount = resolveOverlayHitTestItemCount(source?.items?.length, minimumItemCount);
    const maxWidth = source?.maxWidth ?? source?.max_width ?? null;
    return { itemCount, maxWidth };
}
