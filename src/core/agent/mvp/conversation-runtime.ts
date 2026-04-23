import type { LLMMessage } from '@xqoder/shared';
import { collectMvpContext } from './context-collector.js';
import { shapeMvpContext } from './context-shaper.js';
import { MvpRuntimeController, type MvpRuntimeControllerOptions } from './orchestrator.js';
import { planMvpTurn, renderMvpPlannerPrompt } from './planner.js';
import { loadMvpRuntimeConfig } from './runtime-config.js';
import type { AgentRuntimeProfile, MvpTaskType } from './types.js';
import type { ConversationForcedStopDirective } from '../../../application/chat/conversation-engine.js';

export interface MvpConversationRuntimeOptions extends MvpRuntimeControllerOptions {
    runtimeProfile?: AgentRuntimeProfile;
}

export interface MvpConversationRuntime {
    prepareMessages(): LLMMessage[];
    runPostToolVerification(): Promise<void>;
    getForcedStopDirective(): ConversationForcedStopDirective | undefined;
    getForcedStopMessage(): string | undefined;
    getCompletionBlocker(): string | undefined;
    getNoToolCompletionBlocker(toolExecutedInCurrentRun: boolean): string | undefined;
    finalizeAssistantResponse(content: string): string;
}

export function createMvpConversationRuntime(
    options: MvpConversationRuntimeOptions,
): MvpConversationRuntime {
    const runtimeConfig = options.runtimeConfig ?? loadMvpRuntimeConfig(options.projectRoot);
    const controller = new MvpRuntimeController({
        ...options,
        runtimeConfig,
    });
    let latestTaskType: MvpTaskType = 'question';

    return {
        prepareMessages(): LLMMessage[] {
            const context = collectMvpContext({
                userGoal: options.userGoal,
                projectRoot: options.projectRoot,
                contextPaths: options.contextPaths,
                session: options.session,
            });
            latestTaskType = context.taskType;
            controller.beginTurn(latestTaskType);

            const shaped = shapeMvpContext(context);
            const plan = planMvpTurn({
                context,
                hasBlockingVerification: Boolean(controller.getCompletionBlocker()),
                hasPendingWrites: controller.hasPendingSuccessfulWrites(),
                runtimeProfile: options.runtimeProfile,
            });

            return [
                ...options.session.getMessages(),
                {
                    role: 'system',
                    content: renderMvpPlannerPrompt(shaped, plan),
                },
            ];
        },
        runPostToolVerification(): Promise<void> {
            return controller.runPostToolVerification();
        },
        getForcedStopDirective(): ConversationForcedStopDirective | undefined {
            if (runtimeConfig.stopConditions.timeoutMs !== undefined) {
                const elapsed = Date.now() - controller.getStartedAtMs();
                if (elapsed > runtimeConfig.stopConditions.timeoutMs) {
                    return {
                        stopReason: 'max_wall_time',
                        message: `⏹ 停止：timeout（已运行 ${controller.getLoopCount()} 轮）`,
                    };
                }
            }

            if (controller.getLoopCount() > runtimeConfig.stopConditions.maxLoops) {
                return {
                    stopReason: 'max_turns',
                    message: `⏹ 停止：max_loops（已运行 ${controller.getLoopCount() - 1} 轮）`,
                };
            }

            return undefined;
        },
        getForcedStopMessage(): string | undefined {
            return this.getForcedStopDirective()?.message;
        },
        getCompletionBlocker(): string | undefined {
            return controller.getCompletionBlocker();
        },
        getNoToolCompletionBlocker(toolExecutedInCurrentRun: boolean): string | undefined {
            if (toolExecutedInCurrentRun || latestTaskType === 'question') {
                return undefined;
            }

            return [
                'Do not finish yet.',
                'No tool activity was recorded in this run.',
                `Task type is ${latestTaskType}, so you must execute real tools before concluding.`,
                'Call one or more tools (search_code, read_file, write_file, run_shell), then continue the loop with real execution evidence.',
            ].join('\n');
        },
        finalizeAssistantResponse(content: string): string {
            if (latestTaskType === 'question') {
                return content;
            }

            if (controller.isCompletionReady()) {
                return content.startsWith('✅ 完成')
                    ? content
                    : `✅ 完成\n${content}`;
            }

            return content;
        },
    };
}
