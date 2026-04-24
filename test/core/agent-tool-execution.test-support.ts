import type {
    ExecutionCapability,
    PermissionSettings,
    ToolCall,
} from '@xqoder/shared';
import { logger as defaultLogger } from '@xqoder/shared';
import {
    executeAgentToolCalls,
    type AgentEventEmitter,
    type AgentToolExecutionDependencies,
} from '../../src/core/agent/agent-tool-execution.js';
import { AgentSession } from '../../src/core/agent/session/session.js';
import {
    ToolRegistry,
    type ToolContext,
} from '../../src/core/agent/tools/tool.js';
import type { AgentCallbacks } from '../../src/core/agent/agent.js';

const DEFAULT_TOOL_CONTEXT: ToolContext = {
    cwd: '/tmp/project',
    projectRoot: '/tmp/project',
};

const DEFAULT_PERMISSIONS: PermissionSettings = {
    defaultMode: 'allow',
    tools: {},
};

const DEFAULT_EMIT = (() => {}) as AgentEventEmitter;

export function createExecutionDependencies(input: {
    toolRegistry: ToolRegistry;
    session: AgentSession;
    toolContext?: Partial<ToolContext>;
    autoApproveTools?: boolean;
    permissions?: PermissionSettings;
    executionCapability?: ExecutionCapability;
    emit?: AgentEventEmitter;
}): AgentToolExecutionDependencies {
    return {
        toolRegistry: input.toolRegistry,
        session: input.session,
        toolContext: {
            ...DEFAULT_TOOL_CONTEXT,
            ...input.toolContext,
        },
        logger: defaultLogger.child('agent-tool-execution-test'),
        llmConfig: {
            provider: 'openai',
            model: 'test-model',
            apiKey: 'test-key',
        },
        autoApproveTools: input.autoApproveTools ?? false,
        permissions: input.permissions ?? DEFAULT_PERMISSIONS,
        ...(input.executionCapability ? { executionCapability: input.executionCapability } : {}),
        disableAllHooks: true,
        emit: input.emit ?? DEFAULT_EMIT,
    };
}

export function createExecutionHarness(input: {
    sessionId: string;
    toolRegistry?: ToolRegistry;
    toolContext?: Partial<ToolContext>;
    autoApproveTools?: boolean;
    permissions?: PermissionSettings;
    executionCapability?: ExecutionCapability;
    emit?: AgentEventEmitter;
}) {
    const toolRegistry = input.toolRegistry ?? new ToolRegistry();
    const session = new AgentSession({ id: input.sessionId });

    return {
        toolRegistry,
        session,
        executeToolCalls: (
            toolCalls: ToolCall[],
            callbacks?: AgentCallbacks,
            streamId: string = 'test-stream',
        ) => executeAgentToolCalls(
            createExecutionDependencies({
                toolRegistry,
                session,
                toolContext: input.toolContext,
                autoApproveTools: input.autoApproveTools,
                permissions: input.permissions,
                executionCapability: input.executionCapability,
                emit: input.emit,
            }),
            toolCalls,
            callbacks,
            streamId,
        ),
    };
}
