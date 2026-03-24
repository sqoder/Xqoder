import { ConfigManager } from '@xqoder/shared';
import type { TerminalInputEvent } from '../terminal-core/input-parser.js';
import { getQuestionFallbackSelection, resolveApprovalInputAction, resolveQuestionInputAction } from '../terminal-core/interaction-protocol.js';

type QuestionResolve = (answer: { requestId: string; selected: string[]; customText?: string }) => void;

interface InteractionGateRuntime {
    sandboxUpgradePromptPending: boolean;
    autoApproveToolsForSession: boolean;
    pendingApprovalResolve: ((approved: boolean) => void) | null;
    pendingQuestionResolve: QuestionResolve | null;
    settings: any;
}

interface InteractionGateDeps {
    dispatch: (event: unknown) => void;
}

export class InteractionGateController {
    constructor(private readonly deps: InteractionGateDeps) {}

    handle(input: TerminalInputEvent, currentState: any, runtime: InteractionGateRuntime): { handled: boolean; state: InteractionGateRuntime } {
        const next = { ...runtime };

        if (next.sandboxUpgradePromptPending && !currentState.pendingApproval && !currentState.pendingQuestion) {
            const normalized = input.type === 'text' ? input.text.trim().toLowerCase() : '';
            const approve = normalized === 'y' || normalized === 'yes';
            const deny = normalized === 'n' || normalized === 'no' || (input.type === 'key' && input.key === 'escape');
            if (approve || deny) {
                next.sandboxUpgradePromptPending = false;
                if (approve) {
                    try {
                        const manager = new ConfigManager();
                        const loaded = manager.load({ cwd: next.settings.dir });
                        manager.update({
                            sandbox: {
                                mode: 'full-access',
                                allowedPaths: loaded.sandbox?.allowedPaths ?? [],
                            },
                        });
                        manager.save();
                        next.settings = { ...next.settings, sandboxMode: 'full-access' };
                        this.deps.dispatch({ type: 'notice.set', notice: 'Sandbox upgraded to full-access (saved).' });
                    } catch (error) {
                        const reason = error instanceof Error ? error.message : String(error);
                        this.deps.dispatch({ type: 'notice.set', notice: `Failed to update sandbox config: ${reason}` });
                    }
                } else {
                    this.deps.dispatch({ type: 'notice.set', notice: 'Keeping sandbox mode: project' });
                }
                return { handled: true, state: next };
            }
        }

        if (currentState.pendingApproval) {
            const action = resolveApprovalInputAction(input, currentState.approvalInput?.selectedIndex ?? 0);
            if (action.type === 'move') {
                this.deps.dispatch({ type: 'approval.menu.move', selectedIndex: action.selectedIndex });
                return { handled: true, state: next };
            }
            if (action.type === 'resolve') {
                if (action.alwaysAllowSession) {
                    next.autoApproveToolsForSession = true;
                }
                next.pendingApprovalResolve?.(action.approved);
                next.pendingApprovalResolve = null;
                return { handled: true, state: next };
            }
        }

        if (currentState.pendingQuestion) {
            const question = currentState.pendingQuestion;
            const questionInput = currentState.questionInput ?? {
                selectedIndex: 0,
                selected: getQuestionFallbackSelection(question),
                customText: '',
            };
            const action = resolveQuestionInputAction(input, question, questionInput);
            if (action.type === 'move') {
                this.deps.dispatch({ type: 'question.menu.move', selectedIndex: action.selectedIndex });
                return { handled: true, state: next };
            }
            if (action.type === 'toggle') {
                this.deps.dispatch({ type: 'question.toggle-option', optionLabel: action.optionLabel });
                return { handled: true, state: next };
            }
            if (action.type === 'append-custom') {
                this.deps.dispatch({ type: 'question.custom.append', text: action.text });
                return { handled: true, state: next };
            }
            if (action.type === 'backspace-custom') {
                this.deps.dispatch({ type: 'question.custom.backspace' });
                return { handled: true, state: next };
            }
            if (action.type === 'submit') {
                next.pendingQuestionResolve?.({
                    requestId: question.requestId,
                    selected: action.selected ?? getQuestionFallbackSelection(question),
                    ...(action.customText ? { customText: action.customText } : {}),
                });
                next.pendingQuestionResolve = null;
                return { handled: true, state: next };
            }
            if (action.type === 'cancel') {
                next.pendingQuestionResolve?.({
                    requestId: question.requestId,
                    selected: getQuestionFallbackSelection(question),
                });
                next.pendingQuestionResolve = null;
                return { handled: true, state: next };
            }
        }

        return { handled: false, state: next };
    }
}
