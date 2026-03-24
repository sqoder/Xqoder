import {
    RuntimeErrorType,
    type PackageManager,
    type RunReport,
} from '@xqoder/shared';
import type { ErrorAnalysis } from '@xqoder/runtime';

export interface RemediationPolicy {
    id: string;
    bucket: string;
    title: string;
    summary: string;
    instructions: string[];
    verification: string[];
    suggestedCommands: string[];
    retryStage: RemediationRetryStage;
    maxAttempts: number;
}

export interface ResolveRemediationPolicyInput {
    runReport?: RunReport;
    analysis?: ErrorAnalysis;
    failureBucket?: string;
    attempt?: number;
    maxAttempts?: number;
    previousAttempts?: RemediationAttemptContext[];
}

export interface RemediationAttemptContext {
    attempt: number;
    suspectedFailureBucket?: string;
    failureBucket?: string;
    remediationPolicyId?: string;
}

export type RemediationRetryStage = 'initial' | 'escalated' | 'final';

interface RemediationPolicyTemplate {
    id: string;
    title: string;
    summary: string;
    instructions: string[];
    verification: string[];
}

const DEFAULT_REMEDIATION_MAX_ATTEMPTS = 3;

const DEFAULT_POLICY_TEMPLATE: RemediationPolicyTemplate = {
    id: 'generic-repair-v1',
    title: '通用最小修复',
    summary: '先缩小故障面，再做最小修改并立刻验证。',
    instructions: [
        '先定位第一个明确失败点，再决定需要改哪一个文件或配置。',
        '避免大范围重构；优先做最小、可验证的修复。',
        '如果日志和代码不一致，先以当前运行输出和配置为准重新确认。',
    ],
    verification: [
        '重新运行最接近失败点的命令，确认同一错误不再出现。',
        '检查是否引入新的依赖、配置或路径问题。',
    ],
};

const POLICY_TEMPLATES: Record<string, RemediationPolicyTemplate> = {
    runtime_dependency_missing: {
        id: 'dependency-missing-v1',
        title: '依赖缺失 / 导入路径修复',
        summary: '先判断是包没安装、工作区包没链接，还是本地文件路径写错了。',
        instructions: [
            '确认缺失的是第三方依赖、工作区包，还是本地相对路径文件。',
            '如果是第三方包缺失，补正确依赖；如果是本地文件缺失，优先修正导入路径或恢复缺失文件。',
            '同步检查 package.json、锁文件和 tsconfig / path alias 是否与导入方式一致。',
        ],
        verification: [
            '重新运行启动或构建命令，确认不再出现 Cannot find module / Module not found。',
            '若补了依赖，确认导入名称、默认导出 / 命名导出和版本语法匹配。',
        ],
    },
    runtime_compile_error: {
        id: 'compile-error-v1',
        title: '编译错误定点修复',
        summary: '围绕首个编译错误做最小改动，不要一次性改很多无关代码。',
        instructions: [
            '优先处理第一条编译错误，因为后续报错可能是连带影响。',
            '检查报错文件的类型、导入、变量名和语法是否与当前框架约定一致。',
            '如果需要改接口或类型定义，优先做向后兼容的最小修复。',
        ],
        verification: [
            '优先运行最小可复现的编译或启动命令，确认错误已经消失。',
            '若修改了类型或导出，检查调用方是否还存在联动报错。',
        ],
    },
    runtime_port_conflict: {
        id: 'port-conflict-v1',
        title: '端口冲突修复',
        summary: '先解决端口分配和启动配置，不要误改业务代码。',
        instructions: [
            '优先检查是否能通过环境变量、配置文件或启动脚本切换端口。',
            '如果项目里人为模拟了端口冲突，移除或修正那段测试 / fixture 代码。',
            '避免把端口修复扩展成服务架构改造。',
        ],
        verification: [
            '重新启动项目，确认端口占用错误消失且地址可访问。',
            '确认文档、配置默认值和运行时输出的端口保持一致。',
        ],
    },
    runtime_config_error: {
        id: 'config-error-v1',
        title: '配置错误修复',
        summary: '聚焦 package.json、环境变量和框架配置，不要先怀疑业务逻辑。',
        instructions: [
            '检查 package.json scripts、环境变量、构建配置和框架入口文件是否缺失或命名错误。',
            '如果是必填环境变量缺失，优先补默认值、示例值或更明确的读取方式。',
            '确保修复后的配置仍符合当前框架和包管理器约定。',
        ],
        verification: [
            '重新执行原始命令，确认 Missing script / env / config 类报错已经消失。',
            '检查新增默认值不会遮蔽生产环境真实配置。',
        ],
    },
    runtime_permission_denied: {
        id: 'permission-denied-v1',
        title: '权限问题修复',
        summary: '优先修正文件权限、输出目录或执行方式，不要乱改源码。',
        instructions: [
            '检查报错文件、脚本或缓存目录的读写 / 执行权限是否正确。',
            '如果构建产物目录不可写，优先调整输出目录或创建缺失目录。',
            '避免通过提权绕过问题，优先修正项目内的权限假设。',
        ],
        verification: [
            '重新执行同一命令，确认不再出现 EACCES / Permission denied。',
            '确认修复不会破坏团队其他机器或 CI 的默认权限模型。',
        ],
    },
    runtime_exception: {
        id: 'runtime-exception-v1',
        title: '运行时异常修复',
        summary: '沿着堆栈和触发条件定位异常源头，避免盲改周边代码。',
        instructions: [
            '先定位第一条真正抛错的堆栈和触发输入。',
            '优先修正空值、未定义引用、类型假设或初始化顺序问题。',
            '如果异常来自边界条件，补守卫逻辑而不是静默吞错。',
        ],
        verification: [
            '重新触发同一路径，确认异常不再抛出。',
            '检查是否需要补充更明确的错误信息或边界保护。',
        ],
    },
    test_failed: {
        id: 'test-failure-v1',
        title: '测试失败修复',
        summary: '先修失败断言背后的真实行为差异，不要直接弱化测试。',
        instructions: [
            '定位首个失败测试，确认是产品行为回归还是测试假设过时。',
            '优先修复业务实现；只有在测试确实过期时才更新测试。',
            '如果失败由共享状态引起，清理 fixture、mock 或全局污染。',
        ],
        verification: [
            '重新运行失败测试集，确认断言稳定通过。',
            '检查相关测试是否仍覆盖原始业务目标。',
        ],
    },
    test_setup_failed: {
        id: 'test-setup-v1',
        title: '测试环境修复',
        summary: '优先修正测试命令、fixture 和依赖，而不是改业务逻辑。',
        instructions: [
            '检查 package.json test script、测试配置文件和依赖是否完整。',
            '确认测试需要的环境变量、fixture 文件和 mock 服务都可用。',
            '如果是 monorepo，确认当前包的 workspace 依赖已正确安装和链接。',
        ],
        verification: [
            '重新运行测试命令，确认 setup 阶段能完整启动。',
            '检查测试环境修复不会污染正式运行配置。',
        ],
    },
    test_timeout: {
        id: 'test-timeout-v1',
        title: '测试超时修复',
        summary: '先找阻塞点和无结束条件，不要直接粗暴拉长超时。',
        instructions: [
            '定位超时发生在启动、异步等待、网络 mock 还是资源释放阶段。',
            '优先修正死循环、未完成 Promise、未关闭句柄和错误的等待条件。',
            '只有在行为本身合理但阈值过紧时才调整 timeout。',
        ],
        verification: [
            '重新运行超时测试，确认稳定在预期时间内完成。',
            '检查是否还残留 open handle 或后台任务未清理。',
        ],
    },
    deploy_validation_failed: {
        id: 'deploy-validation-v1',
        title: '部署配置校验修复',
        summary: '优先修正 deploy config 本身，而不是先怀疑平台。',
        instructions: [
            '检查 target、buildCommand、outputDir、env 和平台特定字段是否齐全且命名正确。',
            '确认配置生成逻辑没有漏掉项目根目录、框架类型或构建产物目录。',
            '保持修复后的配置与当前部署平台文档约定一致。',
        ],
        verification: [
            '重新执行 deploy config 校验，确认所有错误已消失。',
            '检查生成配置与实际项目结构一致。',
        ],
    },
    deploy_prepare_failed: {
        id: 'deploy-prepare-v1',
        title: '部署准备修复',
        summary: '先修正准备阶段的数据和配置拼装，再进入真正部署。',
        instructions: [
            '检查部署前收集的项目名、输出目录、build 命令和平台参数是否缺失。',
            '如果准备逻辑依赖检测结果，确认框架识别与项目结构匹配。',
            '避免在准备阶段做过多隐式猜测，优先使用显式配置。',
        ],
        verification: [
            '重新执行准备阶段，确认能稳定产出完整 deploy config。',
            '检查准备结果对不同项目类型仍然兼容。',
        ],
    },
    deploy_auth_failed: {
        id: 'deploy-auth-v1',
        title: '部署鉴权修复',
        summary: '聚焦 token、scope、权限和注入链路，不要先改构建逻辑。',
        instructions: [
            '核对部署平台 token、scope、组织权限和 CI 注入方式是否一致。',
            '检查本地和 CI 使用的是不是同一套环境变量名称。',
            '避免把鉴权失败误判成 build 失败或 output 配置问题。',
        ],
        verification: [
            '重新执行部署，确认鉴权阶段已通过。',
            '检查日志中不再出现 auth、permission、token 相关报错。',
        ],
    },
    deploy_build_failed: {
        id: 'deploy-build-v1',
        title: '部署构建修复',
        summary: '把部署构建当成独立环境排查，优先看 build 命令和产物依赖。',
        instructions: [
            '确认 deploy 使用的 buildCommand 与本地验证通过的命令一致。',
            '检查生产构建需要的环境变量、依赖和 node 版本是否齐全。',
            '如果本地能过而部署不过，优先比较构建环境差异。',
        ],
        verification: [
            '重新执行部署构建，确认 build 阶段通过。',
            '检查构建产物中关键入口文件和静态资源都已生成。',
        ],
    },
    deploy_output_failed: {
        id: 'deploy-output-v1',
        title: '部署产物输出修复',
        summary: '聚焦 outputDir 和产物路径，不要一开始就改平台集成。',
        instructions: [
            '检查 outputDir 是否真实存在，并与构建脚本产物目录一致。',
            '确认静态站点、SSR 和 API 项目的输出模式没有混淆。',
            '如果平台需要特定目录结构，优先在配置层修正。',
        ],
        verification: [
            '重新构建并检查输出目录，确认关键产物可见。',
            '重新部署，确认平台可以读取到预期输出。',
        ],
    },
};

export function deriveRemediationFailureBucket(input: ResolveRemediationPolicyInput): string {
    if (input.failureBucket?.trim()) {
        return normalizeRemediationFailureBucket(input.failureBucket);
    }

    const runtimeErrorTypes = input.runReport?.errors.map((error) => error.type) ?? [];
    const analysisErrorTypes = input.analysis?.errors.map((error) => error.type) ?? [];
    const errorTypes = runtimeErrorTypes.length > 0 ? runtimeErrorTypes : analysisErrorTypes;

    if (errorTypes.length > 0) {
        return resolveRuntimeFailureBucket(errorTypes);
    }

    return 'runtime_failed';
}

export function resolveRemediationPolicy(input: ResolveRemediationPolicyInput): RemediationPolicy {
    const bucket = deriveRemediationFailureBucket(input);
    const template = POLICY_TEMPLATES[bucket] ?? DEFAULT_POLICY_TEMPLATE;
    const maxAttempts = resolveRemediationMaxAttempts(input.maxAttempts);
    const retryStage = resolveRemediationRetryStage(bucket, input.previousAttempts ?? [], {
        attempt: input.attempt,
        maxAttempts,
    });
    const variant = applyRetryStage(template, retryStage);

    return {
        ...variant,
        bucket,
        suggestedCommands: collectSuggestedCommands(
            input.analysis?.autoFixCommands ?? [],
            input.runReport?.packageManager ?? 'unknown',
        ),
        retryStage,
        maxAttempts,
    };
}

export function resolveRemediationMaxAttempts(requestedAttempts?: number): number {
    const normalized = normalizePositiveInteger(requestedAttempts);
    if (!normalized) {
        return DEFAULT_REMEDIATION_MAX_ATTEMPTS;
    }

    return Math.min(normalized, DEFAULT_REMEDIATION_MAX_ATTEMPTS);
}

export function normalizeRemediationFailureBucket(bucket: string): string {
    switch (bucket) {
        case 'verification_dependency_missing':
            return 'runtime_dependency_missing';
        case 'verification_compile_error':
            return 'runtime_compile_error';
        case 'verification_port_conflict':
            return 'runtime_port_conflict';
        case 'verification_config_error':
            return 'runtime_config_error';
        case 'verification_permission_denied':
            return 'runtime_permission_denied';
        case 'verification_runtime_exception':
            return 'runtime_exception';
        case 'verification_failed':
            return 'runtime_failed';
        default:
            return bucket;
    }
}

function resolveRuntimeFailureBucket(errorTypes: RuntimeErrorType[]): string {
    const runtimeErrorType = errorTypes[0];
    switch (runtimeErrorType) {
        case RuntimeErrorType.DependencyMissing:
            return 'runtime_dependency_missing';
        case RuntimeErrorType.CompileError:
            return 'runtime_compile_error';
        case RuntimeErrorType.PortConflict:
            return 'runtime_port_conflict';
        case RuntimeErrorType.ConfigError:
            return 'runtime_config_error';
        case RuntimeErrorType.PermissionDenied:
            return 'runtime_permission_denied';
        case RuntimeErrorType.RuntimeException:
            return 'runtime_exception';
        default:
            return 'runtime_failed';
    }
}

function collectSuggestedCommands(
    commands: string[],
    packageManager: PackageManager,
): string[] {
    const normalized = commands
        .map((command) => rewriteInstallCommand(command, packageManager))
        .filter((command) => command.trim().length > 0);

    return [...new Set(normalized)];
}

function rewriteInstallCommand(command: string, packageManager: PackageManager): string {
    const installMatch = command.match(/^npm install(\s+-D)?\s+(.+)$/);
    if (!installMatch) {
        return command;
    }

    const devFlag = installMatch[1] ?? '';
    const dependencies = installMatch[2] ?? '';

    switch (packageManager) {
        case 'pnpm':
            return `pnpm add${devFlag} ${dependencies}`.trim();
        case 'yarn':
            return `yarn add${devFlag} ${dependencies}`.trim();
        default:
            return command;
    }
}

function resolveRemediationRetryStage(
    bucket: string,
    previousAttempts: RemediationAttemptContext[],
    input: {
        attempt?: number;
        maxAttempts: number;
    },
): RemediationRetryStage {
    const attempt = normalizePositiveInteger(input.attempt) ?? (previousAttempts.length + 1);
    const consecutiveMatches = countTrailingMatchingBuckets(bucket, previousAttempts);

    if (attempt >= input.maxAttempts || consecutiveMatches + 1 >= input.maxAttempts) {
        return 'final';
    }
    if (consecutiveMatches > 0) {
        return 'escalated';
    }
    return 'initial';
}

function countTrailingMatchingBuckets(
    bucket: string,
    previousAttempts: RemediationAttemptContext[],
): number {
    let matches = 0;

    for (let index = previousAttempts.length - 1; index >= 0; index -= 1) {
        const previousBucket = resolveAttemptBucket(previousAttempts[index]);
        if (previousBucket !== bucket) {
            break;
        }
        matches += 1;
    }

    return matches;
}

function resolveAttemptBucket(attempt: RemediationAttemptContext | undefined): string | undefined {
    const rawBucket = attempt?.suspectedFailureBucket?.trim()
        || attempt?.failureBucket?.trim();
    if (!rawBucket) {
        return undefined;
    }

    return normalizeRemediationFailureBucket(rawBucket);
}

function applyRetryStage(
    template: RemediationPolicyTemplate,
    retryStage: RemediationRetryStage,
): RemediationPolicyTemplate {
    switch (retryStage) {
        case 'escalated':
            return {
                id: rewriteRetryStageId(template.id, 'v2'),
                title: `${template.title}（二次修复）`,
                summary: `上一轮同类修复没有通过。${template.summary}`,
                instructions: [
                    ...template.instructions,
                    '不要重复上一轮完全相同的修改路径，先说明上一轮为什么没有真正消除报错。',
                    '把排查范围从报错行扩展到调用链、入口配置或生成产物，确认根因没有被表象掩盖。',
                ],
                verification: [
                    ...template.verification,
                    '在原始命令之外，再补一个更小粒度的验证动作，确认这次命中了真正根因。',
                ],
            };
        case 'final':
            return {
                id: rewriteRetryStageId(template.id, 'v3'),
                title: `${template.title}（最后一次）`,
                summary: `最后一次同类修复机会。${template.summary}`,
                instructions: [
                    ...template.instructions,
                    '先总结前几轮失败共同点，再决定这次只做哪一个最可能成功的修复。',
                    '如果根因仍不明确，优先补日志、类型检查或配置核对，避免第三次重复试错。',
                ],
                verification: [
                    ...template.verification,
                    '除原始验证命令外，再增加一个直接覆盖根因的验证步骤，避免误判为已修复。',
                ],
            };
        default:
            return template;
    }
}

function rewriteRetryStageId(id: string, version: 'v2' | 'v3'): string {
    if (/-v\d+$/.test(id)) {
        return id.replace(/-v\d+$/, `-${version}`);
    }
    return `${id}-${version}`;
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }

    const normalized = Math.floor(value);
    if (normalized <= 0) {
        return undefined;
    }

    return normalized;
}
