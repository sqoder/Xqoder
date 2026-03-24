export type MessagePart =
    | { type: 'text'; content: string }
    | {
        type: 'tool';
        toolName: string;
        status: 'pending' | 'running' | 'done' | 'error';
        summary: string;
        collapsed: boolean;
    }
    | { type: 'context_group'; items: string[]; collapsed: boolean }
    | { type: 'thinking'; content: string };

export type InputPart =
    | { type: 'text'; content: string }
    | { type: 'file_pill'; display: string; uri: string }
    | { type: 'agent_pill'; display: string; agentId: string }
    | { type: 'pasted'; wordCount: number }
    | { type: 'image'; index: number };

export interface TUIState {
    messages: Array<{
        id: string;
        role: 'user' | 'assistant';
        parts: MessagePart[];
        timestamp: number;
    }>;
    input: {
        parts: InputPart[];
        cursorGrapheme: number;
        mode: 'normal' | 'shell';
    };
    sidebar: {
        sessionId: string;
        cwd: string;
        model: string;
        agent: string;
        mode: string;
        contextUsed: number;
        contextMax: number;
        costUsdThis: number;
        costUsdToday: number;
        todayMessages: number;
        lspLines: string[];
    };
    status: {
        thinking: boolean;
        text: string;
    };
    scroll: {
        offsetLines: number;
        stickyBottom: boolean;
    };
}
