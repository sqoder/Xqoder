import { Buffer } from 'node:buffer';
import type { AgentProvider, AgentTask, QuestionAnswer, QuestionPrompt, RuntimeDescriptor, ToolApprovalPrompt } from '@xqoder/plugin-sdk';
import type { AppEvent, CoreMessage, JsonValue, MessageAttachment as ProtocolAttachment } from '@xqoder/protocol';
import type { LLMMessage, MessageAttachment as SharedAttachment } from '@xqoder/shared';
import { AgentSession } from './session/session.js';
import { DEFAULT_SYSTEM_PROMPT, XQoderAgent, type AgentCallbacks, type AgentConfig } from './agent.js';
import type { ToolApprovalRequest } from './tools/tool.js';

type AgentTaskWithAttachments = AgentTask & { attachments?: ProtocolAttachment[] };

interface AgentLike {
  run(userMessage: string, callbacks?: AgentCallbacks, attachments?: SharedAttachment[]): Promise<string>;
  dispose?(): Promise<void>;
}

export type AgentConfigResolver = AgentConfig | ((task: AgentTask, runtime: RuntimeDescriptor) => Promise<AgentConfig> | AgentConfig);

export interface XQoderAgentProviderOptions {
  name?: string;
  createAgent?: (config: AgentConfig) => AgentLike;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }

    this.values.push(value);
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ value, done: false });
        }

        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }

        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

function toSharedAttachment(attachment: ProtocolAttachment): SharedAttachment {
  if (attachment.kind === 'image') {
    return {
      type: 'image',
      mimeType: attachment.mimeType ?? 'image/png',
      data: attachment.data,
      fileName: attachment.fileName,
      filePath: attachment.filePath,
    };
  }

  if (attachment.kind === 'text') {
    return {
      type: 'file',
      mimeType: attachment.mimeType ?? 'text/plain',
      data: attachment.data ?? Buffer.from(attachment.text ?? '', 'utf8').toString('base64'),
      fileName: attachment.fileName,
      filePath: attachment.filePath,
    };
  }

  return {
    type: 'file',
    mimeType: attachment.mimeType ?? 'application/octet-stream',
    data: attachment.data,
    fileName: attachment.fileName,
    filePath: attachment.filePath,
  };
}

function toProtocolAttachment(attachment: SharedAttachment): ProtocolAttachment {
  return {
    kind: attachment.type,
    mimeType: attachment.mimeType,
    data: attachment.data,
    fileName: attachment.fileName,
    filePath: attachment.filePath,
  };
}

function toSharedMessage(message: CoreMessage): LLMMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments && message.attachments.length > 0
      ? {
          attachments: message.attachments.map(toSharedAttachment),
        }
      : {}),
  };
}

function toCoreMessage(message: LLMMessage, sessionId: string, messageId: string, createdAt: number): CoreMessage {
  return {
    id: messageId,
    sessionId,
    role: message.role,
    content: message.content,
    createdAt,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments && message.attachments.length > 0
      ? {
          attachments: message.attachments.map(toProtocolAttachment),
        }
      : {}),
  };
}

function resolveAgentConfig(
  resolver: AgentConfigResolver,
  task: AgentTask,
  runtime: RuntimeDescriptor,
): Promise<AgentConfig> | AgentConfig {
  return typeof resolver === 'function'
    ? resolver(task, runtime)
    : resolver;
}

function createSessionForTask(task: AgentTask, runtime: RuntimeDescriptor, config: AgentConfig): AgentSession {
  if (config.session) {
    return config.session;
  }

  const history = task.messages.map(toSharedMessage);
  const hasSystemMessage = history.some((message) => message.role === 'system');
  const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  return new AgentSession({
    id: runtime.sessionId,
    title: config.sessionTitle,
    messages: hasSystemMessage
      ? history
      : [{ role: 'system', content: systemPrompt }, ...history],
  });
}

function createEventBase(type: AppEvent['type'], runtime: RuntimeDescriptor): Omit<AppEvent, never> {
  return {
    type,
    sessionId: runtime.sessionId,
    timestamp: Date.now(),
    source: 'agent',
  } as AppEvent;
}

async function resolveApprovalDecision(
    request: ToolApprovalRequest,
    runtime: RuntimeDescriptor,
    events: AsyncEventQueue<AppEvent>,
): Promise<boolean> {
    const requestId = `${runtime.sessionId}:${request.toolCallId}`;
    const approvalPrompt: ToolApprovalPrompt = {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        summary: request.summary,
        reason: request.reason,
        preview: request.preview,
        risk: request.risk,
    };

    if (runtime.requestToolApproval) {
        events.push({
            ...createEventBase('approval.requested', runtime),
            type: 'approval.requested',
            requestId,
            kind: 'tool.use',
            summary: request.summary,
            payload: request.preview ?? request.reason,
        });

        const decision = await runtime.requestToolApproval(approvalPrompt);
        events.push({
            ...createEventBase('approval.resolved', runtime),
            type: 'approval.resolved',
            requestId,
            decision,
        });
        return decision === 'allow';
    }

    const decision = await runtime.permissionPolicy.evaluate({
        kind: 'tool.use',
        target: request.toolName,
        sessionId: runtime.sessionId,
        cwd: runtime.cwd,
        payload: request.preview as JsonValue | undefined,
    });

    if (decision !== 'allow') {
        events.push({
            ...createEventBase('approval.requested', runtime),
            type: 'approval.requested',
            requestId,
            kind: 'tool.use',
            summary: request.summary,
            payload: request.preview ?? request.reason,
        });
    }

    events.push({
        ...createEventBase('approval.resolved', runtime),
        type: 'approval.resolved',
        requestId,
        decision,
    });

    return decision === 'allow';
}

async function resolveQuestionDecision(
    request: QuestionPrompt,
    runtime: RuntimeDescriptor,
    events: AsyncEventQueue<AppEvent>,
): Promise<QuestionAnswer> {
    events.push({
        ...createEventBase('question.requested', runtime),
        type: 'question.requested',
        requestId: request.requestId,
        question: request.question,
        ...(request.header ? { header: request.header } : {}),
        options: request.options,
        ...(request.multiple ? { multiple: true } : {}),
        ...(request.allowCustom ? { allowCustom: true } : {}),
    });

    if (runtime.requestQuestion) {
        const answer = await runtime.requestQuestion(request);
        const normalized = {
            requestId: request.requestId,
            selected: answer.selected ?? [],
            ...(answer.customText ? { customText: answer.customText } : {}),
        } satisfies QuestionAnswer;
        events.push({
            ...createEventBase('question.resolved', runtime),
            type: 'question.resolved',
            requestId: request.requestId,
            selected: normalized.selected,
            ...(normalized.customText ? { customText: normalized.customText } : {}),
            answerSource: 'ui',
        });
        return normalized;
    }

    const fallback: QuestionAnswer = {
        requestId: request.requestId,
        selected: request.options.length > 0 ? [request.options[0]!.label] : [],
    };
    events.push({
        ...createEventBase('question.resolved', runtime),
        type: 'question.resolved',
        requestId: request.requestId,
        selected: fallback.selected,
        answerSource: 'fallback',
    });
    return fallback;
}

export class XQoderAgentProvider implements AgentProvider {
  readonly name: string;
  private readonly createAgent: (config: AgentConfig) => AgentLike;

  constructor(
    private readonly configResolver: AgentConfigResolver,
    options: XQoderAgentProviderOptions = {},
  ) {
    this.name = options.name ?? 'xqoder-agent';
    this.createAgent = options.createAgent ?? ((config) => new XQoderAgent(config));
  }

  async *run(task: AgentTask, runtime: RuntimeDescriptor): AsyncIterable<AppEvent> {
    const config = await resolveAgentConfig(this.configResolver, task, runtime);
    const session = createSessionForTask(task, runtime, config);
    const agent = this.createAgent({
      ...config,
      cwd: config.cwd ?? runtime.cwd,
      projectRoot: config.projectRoot ?? runtime.cwd,
      session,
    });

    const events = new AsyncEventQueue<AppEvent>();
    const userMessageId = `${runtime.sessionId}:user:${Date.now()}`;
    const assistantMessageId = `${runtime.sessionId}:assistant:${Date.now()}`;
    const createdAt = Date.now();
    const attachments = (task as AgentTaskWithAttachments).attachments?.map(toSharedAttachment) ?? [];

    const userMessage = toCoreMessage({
      role: 'user',
      content: task.prompt,
      ...(attachments.length > 0 ? { attachments } : {}),
    }, runtime.sessionId, userMessageId, createdAt);

    const runPromise = (async () => {
      let assistantStarted = false;
      let assistantText = '';
      let completedAssistantMessage: LLMMessage | null = null;

      const ensureAssistantStarted = (): void => {
        if (assistantStarted) {
          return;
        }

        assistantStarted = true;
        events.push({
          ...createEventBase('message.started', runtime),
          type: 'message.started',
          message: {
            id: assistantMessageId,
            sessionId: runtime.sessionId,
            role: 'assistant',
            content: '',
            createdAt,
          },
        });
      };

      events.push({
        ...createEventBase('message.started', runtime),
        type: 'message.started',
        message: userMessage,
      });
      events.push({
        ...createEventBase('message.completed', runtime),
        type: 'message.completed',
        message: userMessage,
      });
      events.push({
        ...createEventBase('status.changed', runtime),
        type: 'status.changed',
        status: 'thinking',
      });

      try {
        const finalText = await agent.run(task.prompt, {
          onIteration: () => {
            events.push({
              ...createEventBase('status.changed', runtime),
              type: 'status.changed',
              status: 'thinking',
            });
          },
          onToken: (token) => {
            ensureAssistantStarted();
            assistantText += token;
            events.push({
              ...createEventBase('message.delta', runtime),
              type: 'message.delta',
              messageId: assistantMessageId,
              role: 'assistant',
              text: token,
            });
          },
          onToolStart: (name, args) => {
            events.push({
              ...createEventBase('tool.called', runtime),
              type: 'tool.called',
              provider: this.name,
              tool: name,
              args: args as JsonValue,
            });
            events.push({
              ...createEventBase('status.changed', runtime),
              type: 'status.changed',
              status: 'running-tool',
            });
          },
          onToolStream: (name, chunk) => {
            events.push({
              ...createEventBase('tool.output', runtime),
              type: 'tool.output',
              provider: this.name,
              tool: name,
              output: chunk,
              partial: true,
            });
          },
          onToolEnd: (name, result, success) => {
            events.push({
              ...createEventBase('tool.output', runtime),
              type: 'tool.output',
              provider: this.name,
              tool: name,
              output: result,
            });
            events.push({
              ...createEventBase('tool.completed', runtime),
              type: 'tool.completed',
              provider: this.name,
              tool: name,
              success,
            });
            events.push({
              ...createEventBase('status.changed', runtime),
              type: 'status.changed',
              status: 'thinking',
            });
          },
          onToolApproval: async (request) => resolveApprovalDecision(request, runtime, events),
          onQuestion: async (request) => resolveQuestionDecision(request, runtime, events),
          onComplete: (message) => {
            completedAssistantMessage = message;
          },
          onError: (error) => {
            events.push({
              ...createEventBase('error', runtime),
              type: 'error',
              message: error.message,
              recoverable: false,
            });
          },
        }, attachments);

        ensureAssistantStarted();
        const completedMessage = completedAssistantMessage ?? {
          role: 'assistant',
          content: assistantText || finalText,
        } satisfies LLMMessage;

        events.push({
          ...createEventBase('message.completed', runtime),
          type: 'message.completed',
          message: toCoreMessage(
            {
              ...completedMessage,
              content: completedMessage.content || finalText,
            },
            runtime.sessionId,
            assistantMessageId,
            Date.now(),
          ),
        });
        events.push({
          ...createEventBase('status.changed', runtime),
          type: 'status.changed',
          status: 'done',
        });
      } catch (error) {
        events.push({
          ...createEventBase('error', runtime),
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        });
        events.push({
          ...createEventBase('status.changed', runtime),
          type: 'status.changed',
          status: 'error',
        });
      } finally {
        await agent.dispose?.();
        events.close();
      }
    })();

    try {
      yield* events;
      await runPromise;
    } finally {
      await runPromise;
    }
  }
}

export function createXQoderAgentProvider(
  configResolver: AgentConfigResolver,
  options?: XQoderAgentProviderOptions,
): XQoderAgentProvider {
  return new XQoderAgentProvider(configResolver, options);
}
