import { Buffer } from 'node:buffer';
import type { AgentProvider, AgentTask, QuestionAnswer, QuestionPrompt, RuntimeDescriptor, ToolApprovalPrompt } from '@xqoder/plugin-sdk';
import {
  createConversationEventEnvelopeEmitter,
} from '@xqoder/protocol';
import type {
  ConversationEventEnvelope,
  CoreMessage,
  JsonValue,
  MessageAttachment as ProtocolAttachment,
} from '@xqoder/protocol';
import type { LLMMessage, MessageAttachment as SharedAttachment } from '@xqoder/shared';
import { AgentSession } from './session/session.js';
import { DEFAULT_SYSTEM_PROMPT, XQoderAgent, type AgentCallbacks, type AgentConfig } from '@xqoder/agent';
import type { ToolApprovalRequest } from './tools/tool.js';
import { resolveRuntimeApprovalRequest } from '../../application/permissions/index.js';
import {
  createApprovalRequestedRecord,
  createApprovalResolvedRecord,
} from '../../domain/permissions/index.js';
import type { ConversationStopReason } from '../../domain/conversation/stop-reason.js';

type AgentTaskWithAttachments = AgentTask & { attachments?: ProtocolAttachment[] };

interface AgentLike {
  run(userMessage: string, callbacks?: AgentCallbacks, attachments?: SharedAttachment[]): Promise<string>;
  streamTurn?(userMessage: string, callbacks?: AgentCallbacks, attachments?: SharedAttachment[]): AsyncIterable<ConversationEventEnvelope>;
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

function resolvePlanWorkflowState(task: AgentTask, sourceTurnId: string | undefined) {
  const workflow = (task.metadata as { workflow?: unknown } | undefined)?.workflow;
  if (!workflow || typeof workflow !== 'object') {
    return undefined;
  }

  const candidate = workflow as {
    kind?: unknown;
    rawGoal?: unknown;
    normalizedGoal?: unknown;
  };
  if (candidate.kind !== 'plan' || typeof candidate.rawGoal !== 'string' || typeof candidate.normalizedGoal !== 'string') {
    return undefined;
  }

  return {
    kind: 'plan' as const,
    rawGoal: candidate.rawGoal,
    normalizedGoal: candidate.normalizedGoal,
    completedAt: new Date(),
    sourceTurnId: sourceTurnId ?? `provider:${Date.now()}`,
  };
}

async function resolveApprovalDecision(
    request: ToolApprovalRequest,
    runtime: RuntimeDescriptor,
    events: AsyncEventQueue<ConversationEventEnvelope>,
    eventEmitter: ReturnType<typeof createConversationEventEnvelopeEmitter>,
): Promise<boolean> {
    return resolveRuntimeApprovalRequest({
        request,
        sessionId: runtime.sessionId,
        cwd: runtime.cwd,
        permissionPolicy: runtime.permissionPolicy,
        requestToolApproval: runtime.requestToolApproval as ((request: ToolApprovalPrompt) => Promise<'allow' | 'deny'> | 'allow' | 'deny') | undefined,
        onApprovalRequested: (record) => {
            const payload = createApprovalRequestedRecord(record.requestId, request);
            events.push(eventEmitter.emitRecord('approval.requested', {
                source: 'agent',
                requestId: payload.requestId,
                kind: payload.kind,
                summary: payload.summary,
                payload: payload.payload as JsonValue | undefined,
            }));
        },
        onApprovalResolved: (record) => {
            const payload = createApprovalResolvedRecord(record.requestId, record.decision);
            events.push(eventEmitter.emitRecord('approval.resolved', {
                source: 'agent',
                requestId: payload.requestId,
                decision: payload.decision,
            }));
        },
    });
}

async function resolveQuestionDecision(
    request: QuestionPrompt,
    runtime: RuntimeDescriptor,
    events: AsyncEventQueue<ConversationEventEnvelope>,
    eventEmitter: ReturnType<typeof createConversationEventEnvelopeEmitter>,
): Promise<QuestionAnswer> {
    events.push(eventEmitter.emitRecord('question.requested', {
        source: 'agent',
        requestId: request.requestId,
        question: request.question,
        ...(request.header ? { header: request.header } : {}),
        options: request.options,
        ...(request.multiple ? { multiple: true } : {}),
        ...(request.allowCustom ? { allowCustom: true } : {}),
    }));

    if (runtime.requestQuestion) {
        const answer = await runtime.requestQuestion(request);
        const normalized = {
            requestId: request.requestId,
            selected: answer.selected ?? [],
            ...(answer.customText ? { customText: answer.customText } : {}),
        } satisfies QuestionAnswer;
        events.push(eventEmitter.emitRecord('question.resolved', {
            source: 'agent',
            requestId: request.requestId,
            selected: normalized.selected,
            ...(normalized.customText ? { customText: normalized.customText } : {}),
            answerSource: 'ui',
        }));
        return normalized;
    }

    const fallback: QuestionAnswer = {
        requestId: request.requestId,
        selected: request.options.length > 0 ? [request.options[0]!.label] : [],
    };
    events.push(eventEmitter.emitRecord('question.resolved', {
        source: 'agent',
        requestId: request.requestId,
        selected: fallback.selected,
        answerSource: 'fallback',
    }));
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

  async *run(task: AgentTask, runtime: RuntimeDescriptor): AsyncIterable<ConversationEventEnvelope> {
    const config = await resolveAgentConfig(this.configResolver, task, runtime);
    const session = createSessionForTask(task, runtime, config);
    const agent = this.createAgent({
      ...config,
      cwd: config.cwd ?? runtime.cwd,
      projectRoot: config.projectRoot ?? runtime.cwd,
      session,
    });

    const eventEmitter = createConversationEventEnvelopeEmitter(runtime.sessionId, runtime.turnId);
    const events = new AsyncEventQueue<ConversationEventEnvelope>();
    const userMessageId = `${runtime.sessionId}:user:${Date.now()}`;
    const assistantMessageId = `${runtime.sessionId}:assistant:${Date.now()}`;
    const createdAt = Date.now();
    const attachments = (task as AgentTaskWithAttachments).attachments?.map(toSharedAttachment) ?? [];

    const userMessage = toCoreMessage({
      role: 'user',
      content: task.prompt,
      ...(attachments.length > 0 ? { attachments } : {}),
    }, runtime.sessionId, userMessageId, createdAt);

    if (agent.streamTurn) {
      let terminalStatus: 'done' | 'error' | undefined;
      let terminalStopReason: ConversationStopReason | undefined;
      let observedTurnId = runtime.turnId;

      try {
        for await (const event of agent.streamTurn(task.prompt, {
          onToolApproval: async (request) => {
            return await resolveRuntimeApprovalRequest({
              request,
              sessionId: runtime.sessionId,
              cwd: runtime.cwd,
              permissionPolicy: runtime.permissionPolicy,
              requestToolApproval: runtime.requestToolApproval as ((request: ToolApprovalPrompt) => Promise<'allow' | 'deny'> | 'allow' | 'deny') | undefined,
            });
          },
          onQuestion: async (request) => {
            if (runtime.requestQuestion) {
              return await runtime.requestQuestion(request);
            }
            return {
              requestId: request.requestId,
              selected: request.options.length > 0 ? [request.options[0]!.label] : [],
            };
          },
        }, attachments)) {
          observedTurnId = event.turnId;
          session.recordConversationEnvelopeEvent(event);
          if (event.type === 'status.changed' && (event.payload.status === 'done' || event.payload.status === 'error')) {
            terminalStatus = event.payload.status;
            terminalStopReason = event.payload.stopReason;
          }
          yield event;
        }

        if (terminalStatus === 'done' && terminalStopReason === 'completed') {
          const workflowState = resolvePlanWorkflowState(task, observedTurnId);
          if (workflowState) {
            session.recordWorkflowState(workflowState);
          }
        }
        return;
      } finally {
        await agent.dispose?.();
      }
    }

    const runPromise = (async () => {
      let assistantStarted = false;
      let assistantText = '';
      // Declared with an explicit widening so the closure assignment below
      // doesn't leave callers narrowing the type back to `null` and seeing
      // `completedAssistantMessage?.content` as `never` under strict flow
      // analysis.
      let completedAssistantMessage: LLMMessage | null = null as LLMMessage | null;
      let errorEmitted = false;
      let terminalStopReason: ConversationStopReason | undefined;

      const ensureAssistantStarted = (): void => {
        if (assistantStarted) {
          return;
        }

        assistantStarted = true;
        events.push(eventEmitter.emitRecord('message.started', {
          source: 'agent',
          message: {
            id: assistantMessageId,
            sessionId: runtime.sessionId,
            role: 'assistant',
            content: '',
            createdAt,
          },
        }));
      };

      events.push(eventEmitter.emitRecord('message.started', {
        source: 'agent',
        message: userMessage,
      }));
      events.push(eventEmitter.emitRecord('message.completed', {
        source: 'agent',
        message: userMessage,
      }));
      events.push(eventEmitter.emitRecord('status.changed', {
        source: 'agent',
        status: 'thinking',
      }));

      try {
        const unsubscribe = (agent as unknown as XQoderAgent).subscribe((event) => {
          if (event.type === 'thought') {
            events.push(eventEmitter.emitRecord('thought', {
              source: 'agent',
              text: event.content,
            }));
          }
        });

        const finalText = await agent.run(task.prompt, {
          onIteration: () => {
            events.push(eventEmitter.emitRecord('status.changed', {
              source: 'agent',
              status: 'thinking',
            }));
          },
          onToken: (token) => {
            ensureAssistantStarted();
            assistantText += token;
            events.push(eventEmitter.emitRecord('message.delta', {
              source: 'agent',
              messageId: assistantMessageId,
              role: 'assistant',
              text: token,
            }));
          },
          onToolStart: (name, args) => {
            events.push(eventEmitter.emitRecord('tool.called', {
              source: 'agent',
              provider: this.name,
              tool: name,
              args: args as JsonValue,
            }));
            events.push(eventEmitter.emitRecord('status.changed', {
              source: 'agent',
              status: 'running-tool',
            }));
          },
          onToolStream: (name, chunk) => {
            events.push(eventEmitter.emitRecord('tool.output', {
              source: 'agent',
              provider: this.name,
              tool: name,
              output: chunk,
              partial: true,
            }));
          },
          onToolEnd: (name, result, success) => {
            events.push(eventEmitter.emitRecord('tool.output', {
              source: 'agent',
              provider: this.name,
              tool: name,
              output: result,
            }));
            events.push(eventEmitter.emitRecord('tool.completed', {
              source: 'agent',
              provider: this.name,
              tool: name,
              success,
            }));
            events.push(eventEmitter.emitRecord('status.changed', {
              source: 'agent',
              status: 'thinking',
            }));
          },
          onToolApproval: async (request) => resolveApprovalDecision(request, runtime, events, eventEmitter),
          onQuestion: async (request) => resolveQuestionDecision(request, runtime, events, eventEmitter),
          onComplete: (message) => {
            completedAssistantMessage = message;
          },
          onError: (error) => {
            if (!errorEmitted) {
              errorEmitted = true;
              events.push(eventEmitter.emitRecord('error', {
                source: 'agent',
                message: error.message,
                recoverable: false,
                ...(terminalStopReason ? { stopReason: terminalStopReason } : {}),
              }));
            }
          },
          onStop: (stopReason) => {
            terminalStopReason = stopReason;
          },
          onEvent: (event) => {
            if (event.type === 'usage') {
              events.push(eventEmitter.emitRecord('usage', {
                source: 'agent',
                model: event.model,
                promptTokens: event.promptTokens,
                completionTokens: event.completionTokens,
                totalTokens: event.totalTokens,
                ...(event.cost !== undefined ? { cost: event.cost } : {}),
              }));
              return;
            }

            if (event.type === 'verification') {
              events.push(eventEmitter.emitRecord('verification.completed', {
                source: 'agent',
                ok: event.ok,
                blocked: event.blocked,
                summary: event.summary,
              }));
            }
          },
        }, attachments);

        unsubscribe();
        ensureAssistantStarted();
        const completedContent = finalText || completedAssistantMessage?.content || assistantText;
        const completedMessage = completedAssistantMessage ?? {
          role: 'assistant',
          content: completedContent,
        } satisfies LLMMessage;

        events.push(eventEmitter.emitRecord('message.completed', {
          source: 'agent',
          message: toCoreMessage(
            {
              ...completedMessage,
              content: completedContent,
            },
            runtime.sessionId,
            assistantMessageId,
            Date.now(),
          ),
        }));
        events.push(eventEmitter.emitRecord('status.changed', {
          source: 'agent',
          status: 'done',
          stopReason: terminalStopReason ?? 'completed',
        }));
        if ((terminalStopReason ?? 'completed') === 'completed') {
          const workflowState = resolvePlanWorkflowState(task, runtime.turnId);
          if (workflowState) {
            session.recordWorkflowState(workflowState);
          }
        }
      } catch (error) {
        if (!errorEmitted) {
          errorEmitted = true;
          events.push(eventEmitter.emitRecord('error', {
            source: 'agent',
            message: error instanceof Error ? error.message : String(error),
            recoverable: false,
            stopReason: terminalStopReason ?? 'provider_error',
          }));
        }
        events.push(eventEmitter.emitRecord('status.changed', {
          source: 'agent',
          status: 'error',
          stopReason: terminalStopReason ?? 'provider_error',
          message: error instanceof Error ? error.message : String(error),
        }));
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
