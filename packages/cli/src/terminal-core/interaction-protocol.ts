import type { TerminalInputEvent } from './input-parser.js';
import type { OverlayState, PendingQuestionState } from './app-state.js';

export const APPROVAL_MENU_LINES = [
    '⏎  Allow once',
    '⏎  Always allow in this session',
    '⏎  Deny',
] as const;

export function getApprovalStatusHint(): string {
    return 'approval: 1 Allow once   2 Always (session)   3 Deny';
}

export function getQuestionStatusHint(multiple: boolean | undefined): string {
    return multiple
        ? 'question: ↑/↓ move  Space toggle  Enter submit  Esc fallback'
        : 'question: ↑/↓ move  Enter submit  Esc fallback';
}

export function getOverlayStatusHint(overlay: OverlayState | null): string | undefined {
    if (!overlay) {
        return undefined;
    }
    switch (overlay.type) {
        case 'session':
        case 'model':
        case 'commands':
        case 'theme':
        case 'init':
            return 'overlay: ↑/↓ move  Enter select  Esc close';
        case 'filepicker':
            return 'overlay: ↑/↓ move  Enter select  l open  Backspace parent  Esc close';
        case 'complete':
            return 'overlay: ↑/↓ move  l expand/collapse  Enter select  Esc cancel';
        case 'arguments':
            return 'overlay: type values  Enter next/submit  Esc close';
        default:
            return undefined;
    }
}

export type ApprovalInputAction =
    | { type: 'none' }
    | { type: 'move'; selectedIndex: 0 | 1 | 2 }
    | { type: 'resolve'; approved: boolean; alwaysAllowSession?: boolean };

export function resolveApprovalInputAction(
    input: TerminalInputEvent,
    selectedIndex: number,
): ApprovalInputAction {
    if (input.type === 'key' && (input.key === 'up' || input.key === 'down')) {
        const delta = input.key === 'down' ? 1 : -1;
        const next = (selectedIndex + delta + 3) % 3;
        return { type: 'move', selectedIndex: next as 0 | 1 | 2 };
    }

    if (input.type === 'text') {
        const normalized = input.text.trim().toLowerCase();
        if (normalized === '1' || normalized === 'y' || normalized === 'yes' || normalized === 'a') {
            return { type: 'resolve', approved: true };
        }
        if (normalized === '2' || normalized === 's') {
            return { type: 'resolve', approved: true, alwaysAllowSession: true };
        }
        if (normalized === '3' || normalized === 'n' || normalized === 'no' || normalized === 'd') {
            return { type: 'resolve', approved: false };
        }
    }

    if (input.type === 'key' && (input.key === 'return' || input.key === 'enter')) {
        if (selectedIndex === 0) {
            return { type: 'resolve', approved: true };
        }
        if (selectedIndex === 1) {
            return { type: 'resolve', approved: true, alwaysAllowSession: true };
        }
        return { type: 'resolve', approved: false };
    }

    if (input.type === 'key' && input.key === 'escape') {
        return { type: 'resolve', approved: false };
    }

    return { type: 'none' };
}

export type QuestionInputAction =
    | { type: 'none' }
    | { type: 'move'; selectedIndex: number }
    | { type: 'toggle'; optionLabel: string }
    | { type: 'append-custom'; text: string }
    | { type: 'backspace-custom' }
    | { type: 'submit'; selected?: string[]; customText?: string }
    | { type: 'cancel' };

export function resolveQuestionInputAction(
    input: TerminalInputEvent,
    question: PendingQuestionState,
): QuestionInputAction {
    if (input.type === 'key' && (input.key === 'up' || input.key === 'down')) {
        const max = Math.max(1, question.options.length);
        const delta = input.key === 'down' ? 1 : -1;
        return { type: 'move', selectedIndex: (question.selectedIndex + delta + max) % max };
    }

    if (input.type === 'text') {
        const normalized = input.text.trim().toLowerCase();
        if (/^[1-9]$/.test(normalized) && question.options.length > 0) {
            const index = Number.parseInt(normalized, 10) - 1;
            const option = question.options[index];
            if (option) {
                if (question.multiple) {
                    return { type: 'toggle', optionLabel: option.label };
                }
                return {
                    type: 'submit',
                    selected: [option.label],
                    ...(question.customText.trim() ? { customText: question.customText.trim() } : {}),
                };
            }
        }

        if (input.text === ' ' && question.multiple) {
            const option = question.options[question.selectedIndex];
            if (option) {
                return { type: 'toggle', optionLabel: option.label };
            }
        }

        if (question.allowCustom && input.text.length > 0) {
            return { type: 'append-custom', text: input.text };
        }
    }

    if (input.type === 'key' && input.key === 'backspace' && question.allowCustom) {
        return { type: 'backspace-custom' };
    }

    if (input.type === 'key' && (input.key === 'return' || input.key === 'enter')) {
        return {
            type: 'submit',
            selected: getQuestionSubmitSelection(question),
            ...(question.customText.trim() ? { customText: question.customText.trim() } : {}),
        };
    }

    if (input.type === 'key' && input.key === 'escape') {
        return { type: 'cancel' };
    }

    return { type: 'none' };
}

export function getQuestionFallbackSelection(question: PendingQuestionState): string[] {
    return question.options.length > 0 ? [question.options[0]!.label] : [];
}

function getQuestionSubmitSelection(question: PendingQuestionState): string[] {
    if (question.multiple) {
        return question.selected;
    }
    if (question.selected.length > 0) {
        return question.selected;
    }
    const focusedOption = question.options[question.selectedIndex];
    return focusedOption ? [focusedOption.label] : [];
}
