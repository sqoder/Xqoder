/**
 * Overlay 命中测试的最小几何规则。
 *
 * 某些 overlay 在 itemCount 为 0 时仍应保留一个可点击框，
 * 因此这里把 itemCount 的下限作为显式参数收口，而不是在 controller 里散写。
 */
export function resolveOverlayHitTestItemCount(
    itemCount: number | null | undefined,
    minimumItemCount = 0,
): number {
    const safeItemCount = Math.max(0, Math.trunc(itemCount ?? 0));
    const safeMinimum = Math.max(0, Math.trunc(minimumItemCount));
    return Math.max(safeItemCount, safeMinimum);
}
