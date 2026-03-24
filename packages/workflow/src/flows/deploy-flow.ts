import {
    DeployStatus,
    StepStatus,
    type DeployConfig,
    type DeployResult,
    WorkflowStatus,
    type ProjectConfig,
    type StepResult,
} from '@xqoder/shared';
import { WorkflowEngine, deriveDefaultFailureBucket, findLastFailedStep } from '../engine.js';
import type { IWorkflowStep } from '../step.js';

export interface DeployProjectFlowOptions {
    userRequest: string;
    projectConfig: ProjectConfig;
    prepareDeployConfig(): Promise<DeployConfig>;
    validateDeployConfig(config: DeployConfig): Promise<{ valid: boolean; errors: string[] }>;
    deployProject(config: DeployConfig): Promise<DeployResult>;
}

export interface DeployProjectFlowResult {
    status: WorkflowStatus;
    deployConfig?: DeployConfig;
    deployResult?: DeployResult;
    stepResults: StepResult[];
    totalDuration: number;
    attemptCount: number;
    automaticActionIds: string[];
    failureBucket?: string;
    resultLabel?: string;
    error?: string;
}

export async function runDeployProjectFlow(
    options: DeployProjectFlowOptions,
): Promise<DeployProjectFlowResult> {
    let deployConfig: DeployConfig | undefined;
    let deployResult: DeployResult | undefined;

    const engine = new WorkflowEngine().addSteps([
        createStep(
            'prepare_deploy_config',
            '准备部署配置',
            async () => {
                deployConfig = await options.prepareDeployConfig();
                return [
                    `target=${deployConfig.target}`,
                    deployConfig.buildCommand ? `build=${deployConfig.buildCommand}` : undefined,
                    deployConfig.outputDir ? `output=${deployConfig.outputDir}` : undefined,
                ].filter((value): value is string => value !== undefined).join('  ');
            },
        ),
        createStep(
            'validate_deploy_config',
            '验证部署配置',
            async () => {
                if (!deployConfig) {
                    throw new Error('部署配置尚未生成');
                }
                const validation = await options.validateDeployConfig(deployConfig);
                if (!validation.valid) {
                    throw new Error(validation.errors.join('\n') || '部署配置校验失败');
                }
                return '部署配置校验通过';
            },
        ),
        createStep(
            'deploy_project',
            '执行项目部署',
            async () => {
                if (!deployConfig) {
                    throw new Error('部署配置尚未生成');
                }
                deployResult = await options.deployProject(deployConfig);
                if (deployResult.status !== DeployStatus.Ready) {
                    throw new Error(deployResult.error ?? `部署失败: ${deployResult.status}`);
                }
                return deployResult.url
                    ? `部署完成: ${deployResult.url}`
                    : `部署完成: ${deployResult.status}`;
            },
        ),
    ]);

    const workflowResult = await engine.execute(
        options.userRequest,
        options.projectConfig,
    );

    return {
        status: workflowResult.status,
        deployConfig,
        deployResult,
        stepResults: workflowResult.stepResults,
        totalDuration: workflowResult.totalDuration,
        attemptCount: 1,
        automaticActionIds: resolveDeployAutomaticActionIds(workflowResult.stepResults),
        ...(workflowResult.status === WorkflowStatus.Failed
            ? { failureBucket: deriveDeployFailureBucket(deployResult, workflowResult.stepResults, workflowResult.error) }
            : {}),
        ...((deployResult ?? deployConfig)
            ? { resultLabel: resolveDeployResultLabel(deployResult, deployConfig) }
            : {}),
        ...(workflowResult.error ? { error: workflowResult.error } : {}),
    };
}

function resolveDeployAutomaticActionIds(stepResults: StepResult[]): string[] {
    const hasValidationStep = stepResults.some((step) => step.stepName === 'validate_deploy_config');
    return hasValidationStep ? ['deploy-config-preflight-v1'] : [];
}

function createStep(
    name: string,
    description: string,
    handler: () => Promise<string>,
): IWorkflowStep {
    return {
        name,
        description,
        async execute(_context) {
            const output = await handler();
            return {
                stepName: name,
                status: StepStatus.Completed,
                output,
                startedAt: new Date(),
                completedAt: new Date(),
            };
        },
        async validate(_context) {
            return true;
        },
    };
}

function resolveDeployResultLabel(
    deployResult: DeployResult | undefined,
    deployConfig: DeployConfig | undefined,
): string {
    if (deployResult?.url) {
        return deployResult.url;
    }
    if (deployResult) {
        return deployResult.status;
    }
    return deployConfig?.target ?? 'deploy_pending';
}

function deriveDeployFailureBucket(
    deployResult: DeployResult | undefined,
    stepResults: StepResult[],
    error: string | undefined,
): string {
    const failedStep = findLastFailedStep(stepResults)?.stepName;
    const failureText = `${deployResult?.error ?? error ?? ''}`.toLowerCase();

    if (failedStep === 'validate_deploy_config') {
        return 'deploy_validation_failed';
    }
    if (failedStep === 'prepare_deploy_config') {
        return 'deploy_prepare_failed';
    }
    if (failedStep === 'deploy_project') {
        if (failureText.includes('token') || failureText.includes('auth') || failureText.includes('permission')) {
            return 'deploy_auth_failed';
        }
        if (failureText.includes('build')) {
            return 'deploy_build_failed';
        }
        if (failureText.includes('output')) {
            return 'deploy_output_failed';
        }
        return 'deploy_failed';
    }

    return deriveDefaultFailureBucket(stepResults) ?? 'deploy_failed';
}
