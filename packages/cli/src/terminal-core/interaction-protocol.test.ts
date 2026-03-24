import { describe, expect, it } from 'vitest';
import {
    getApprovalStatusHint,
    getQuestionFallbackSelection,
    getQuestionStatusHint,
    resolveApprovalInputAction,
    resolveQuestionInputAction,
} from './interaction-protocol.js';
import type { PendingQuestionState, QuestionInteractionState } from './app-state.js';

describe('interaction protocol', () => {
    it('maps approval shortcuts to deterministic decisions', () => {
        expect(resolveApprovalInputAction({ type: 'text', text: '2', raw: '2' }, 0)).toEqual({
            type: 'resolve',
            approved: true,
            alwaysAllowSession: true,
        });
        expect(resolveApprovalInputAction({ type: 'key', key: 'escape', raw: '\u001b' }, 1)).toEqual({
            type: 'resolve',
            approved: false,
        });
        expect(resolveApprovalInputAction({ type: 'key', key: 'tab', raw: '\t' }, 0)).toEqual({
            type: 'move',
            selectedIndex: 1,
        });
        expect(resolveApprovalInputAction({ type: 'key', key: 'left', raw: '\u001b[D' }, 0)).toEqual({
            type: 'move',
            selectedIndex: 2,
        });
        expect(resolveApprovalInputAction({ type: 'text', text: ' ', raw: ' ' }, 2)).toEqual({
            type: 'resolve',
            approved: false,
        });
        expect(getApprovalStatusHint()).toContain('a/s/d');
    });

    it('supports question submit/cancel with fallback and hints', () => {
        const question: PendingQuestionState = {
            requestId: 'q1',
            question: 'Pick mode',
            options: [{ label: 'Parity' }, { label: 'Speed' }],
            multiple: false,
            allowCustom: false,
        };
        const input: QuestionInteractionState = {
            selectedIndex: 0,
            selected: ['Parity'],
            customText: '',
        };

        expect(resolveQuestionInputAction({ type: 'key', key: 'enter', raw: '\r' }, question, input)).toEqual({
            type: 'submit',
            selected: ['Parity'],
        });
        expect(resolveQuestionInputAction({ type: 'key', key: 'escape', raw: '\u001b' }, question, input)).toEqual({
            type: 'cancel',
        });
        expect(getQuestionFallbackSelection(question)).toEqual(['Parity']);
        expect(getQuestionStatusHint(false)).toContain('Enter submit');
    });
});
