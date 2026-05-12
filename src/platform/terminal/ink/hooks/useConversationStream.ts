// P06 — useConversationStream: bridges AgentConversationPort events to React state.
import { useReducer, useRef, useCallback } from 'react';
import type { AgentConversationPort, AgentRuntimeEvent, TuiAgentSettings, AgentQuestionRequest, AgentQuestionAnswer } from '../../../../application/agent/ports.js';
import type { ToolApprovalRequest } from '../../../../core/agent/tools/tool.js';
import type { MessageEntry } from '../components/messages/index.js';

export interface PendingApproval {
    request: ToolApprovalRequest;
    resolve: (approved: boolean) => void;
}

export interface PendingQuestion {
    request: AgentQuestionRequest;
    resolve: (answer: AgentQuestionAnswer) => void;
}

export interface ConversationState {
    messages: MessageEntry[];
    thinking: boolean;
    thinkingText: string;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    sessionId: string | undefined;
    history: string[];
    pendingApproval: PendingApproval | null;
    pendingQuestion: PendingQuestion | null;
    isBusy: boolean;
    error: string | null;
}

type Action =
    | { type: 'message.delta'; id: string; text: string }
    | { type: 'message.completed'; id: string; content: string }
    | { type: 'thought'; text: string }
    | { type: 'tool.called'; id: string; tool: string; args: Record<string, unknown> }
    | { type: 'tool.completed'; id: string; tool: string; success: boolean }
    | { type: 'usage'; promptTokens: number; completionTokens: number; cost?: number }
    | { type: 'status.changed'; status: string }
    | { type: 'error'; message: string }
    | { type: 'session.started'; sessionId: string }
    | { type: 'send.start'; userText: string }
    | { type: 'send.done'; sessionId: string }
    | { type: 'approval.pending'; approval: PendingApproval }
    | { type: 'approval.resolved' }
    | { type: 'question.pending'; question: PendingQuestion }
    | { type: 'question.resolved' };

const initialState: ConversationState = {
    messages: [],
    thinking: false,
    thinkingText: '',
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
    sessionId: undefined,
    history: [],
    pendingApproval: null,
    pendingQuestion: null,
    isBusy: false,
    error: null,
};

function nextId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export type ConversationAction = Action;
export { initialState as conversationInitialState };

export function conversationReducer(state: ConversationState, action: Action): ConversationState {
    return reduce(state, action);
}

function reduce(state: ConversationState, action: Action): ConversationState {
    switch (action.type) {
        case 'send.start': {
            const userMsg: MessageEntry = {
                id: nextId(),
                role: 'user',
                content: action.userText,
                timestamp: new Date(),
            };
            return {
                ...state,
                isBusy: true,
                error: null,
                thinking: false,
                thinkingText: '',
                messages: [...state.messages, userMsg],
            };
        }

        case 'message.delta': {
            const existing = state.messages.find((m) => m.id === action.id);
            if (existing) {
                return {
                    ...state,
                    messages: state.messages.map((m) =>
                        m.id === action.id ? { ...m, content: m.content + action.text, streaming: true } : m,
                    ),
                };
            }
            const newMsg: MessageEntry = {
                id: action.id,
                role: 'assistant',
                content: action.text,
                timestamp: new Date(),
                streaming: true,
            };
            return { ...state, messages: [...state.messages, newMsg] };
        }

        case 'message.completed': {
            return {
                ...state,
                messages: state.messages.map((m) =>
                    m.id === action.id ? { ...m, content: action.content, streaming: false } : m,
                ),
            };
        }

        case 'thought':
            return { ...state, thinking: true, thinkingText: action.text };

        case 'tool.called': {
            const toolMsg: MessageEntry = {
                id: action.id,
                role: 'assistant',
                content: `[tool] ${action.tool}`,
                timestamp: new Date(),
            };
            return { ...state, messages: [...state.messages, toolMsg] };
        }

        case 'tool.completed':
            return { ...state, thinking: false };

        case 'status.changed':
            return { ...state, thinking: action.status === 'thinking' };

        case 'usage':
            return {
                ...state,
                promptTokens: state.promptTokens + action.promptTokens,
                completionTokens: state.completionTokens + action.completionTokens,
                cost: state.cost + (action.cost ?? 0),
            };

        case 'error':
            return { ...state, isBusy: false, error: action.message, thinking: false };

        case 'session.started':
            return { ...state, sessionId: action.sessionId };

        case 'send.done':
            return {
                ...state,
                isBusy: false,
                thinking: false,
                sessionId: action.sessionId,
            };

        case 'approval.pending':
            return { ...state, pendingApproval: action.approval };

        case 'approval.resolved':
            return { ...state, pendingApproval: null };

        case 'question.pending':
            return { ...state, pendingQuestion: action.question };

        case 'question.resolved':
            return { ...state, pendingQuestion: null };

        default:
            return state;
    }
}

export interface UseConversationStreamOptions {
    agentService: AgentConversationPort;
    settings: TuiAgentSettings;
    initialSessionId?: string;
}

export interface UseConversationStreamResult extends ConversationState {
    submit: (text: string) => void;
    cancel: () => void;
    resolveApproval: (approved: boolean) => void;
    resolveQuestion: (answer: AgentQuestionAnswer) => void;
}

export function useConversationStream({
    agentService,
    settings,
    initialSessionId,
}: UseConversationStreamOptions): UseConversationStreamResult {
    const [state, dispatch] = useReducer(reduce, {
        ...initialState,
        sessionId: initialSessionId,
    });

    const approvalResolveRef = useRef<((approved: boolean) => void) | null>(null);
    const questionResolveRef = useRef<((answer: AgentQuestionAnswer) => void) | null>(null);

    const submit = useCallback((text: string) => {
        if (!text.trim() || agentService.isBusy) return;

        dispatch({ type: 'send.start', userText: text });

        // Track streaming message id
        let currentAssistantId: string | null = null;

        const onEvent = (event: AgentRuntimeEvent): void => {
            if (event.type === 'message.delta' && event.payload.role === 'assistant') {
                if (!currentAssistantId) currentAssistantId = nextId();
                dispatch({ type: 'message.delta', id: currentAssistantId, text: event.payload.text ?? '' });
            } else if (event.type === 'message.completed' && event.payload.message.role === 'assistant') {
                if (currentAssistantId) {
                    const content = typeof event.payload.message.content === 'string'
                        ? event.payload.message.content
                        : String(event.payload.message.content ?? '');
                    dispatch({ type: 'message.completed', id: currentAssistantId, content });
                    currentAssistantId = null;
                }
            } else if (event.type === 'thought') {
                dispatch({ type: 'thought', text: event.payload.text ?? '' });
            } else if (event.type === 'tool.called') {
                dispatch({ type: 'tool.called', id: nextId(), tool: event.payload.tool, args: (event.payload.args as Record<string, unknown>) ?? {} });
            } else if (event.type === 'tool.completed') {
                dispatch({ type: 'tool.completed', id: nextId(), tool: event.payload.tool, success: event.payload.success });
            } else if (event.type === 'status.changed') {
                dispatch({ type: 'status.changed', status: event.payload.status });
            } else if (event.type === 'usage') {
                dispatch({ type: 'usage', promptTokens: event.payload.promptTokens ?? 0, completionTokens: event.payload.completionTokens ?? 0, cost: event.payload.cost });
            } else if (event.type === 'session.started') {
                // sessionId is on the envelope, not the payload
                dispatch({ type: 'session.started', sessionId: event.sessionId });
            } else if (event.type === 'error') {
                dispatch({ type: 'error', message: event.payload.message });
            }
        };

        const onToolApproval = (request: ToolApprovalRequest): Promise<boolean> => {
            return new Promise<boolean>((resolve) => {
                approvalResolveRef.current = resolve;
                dispatch({
                    type: 'approval.pending',
                    approval: { request, resolve },
                });
            });
        };

        const onQuestion = (request: AgentQuestionRequest): Promise<AgentQuestionAnswer> => {
            return new Promise<AgentQuestionAnswer>((resolve) => {
                questionResolveRef.current = resolve;
                dispatch({
                    type: 'question.pending',
                    question: { request, resolve },
                });
            });
        };

        agentService.sendMessage(text, state.sessionId, settings, [], {
            onEvent,
            onToolApproval,
            onQuestion,
        }).then((result) => {
            dispatch({ type: 'send.done', sessionId: result.sessionId });
        }).catch((err: unknown) => {
            dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        });
    }, [agentService, settings, state.sessionId]);

    const cancel = useCallback(() => {
        agentService.cancel();
    }, [agentService]);

    const resolveApproval = useCallback((approved: boolean) => {
        approvalResolveRef.current?.(approved);
        approvalResolveRef.current = null;
        dispatch({ type: 'approval.resolved' });
    }, []);

    const resolveQuestion = useCallback((answer: AgentQuestionAnswer) => {
        questionResolveRef.current?.(answer);
        questionResolveRef.current = null;
        dispatch({ type: 'question.resolved' });
    }, []);

    return { ...state, submit, cancel, resolveApproval, resolveQuestion };
}
