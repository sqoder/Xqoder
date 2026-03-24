/**
 * 估算终端输入区需要占用的行数。
 *
 * 这不是最终布局真相，但它是 Rust layout / hit-test 的统一入参之一，
 * 所以应该集中在一个 helper 里，避免各 controller 各写一份规则。
 */
export function estimateInputLinesForLayout(editorValue: string): number {
    return Math.max(1, Math.min(6, editorValue.split('\n').length));
}
