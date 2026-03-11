// ============================================================
// xqoder test — 运行项目测试
// ============================================================

import { Command } from 'commander';
import { TestStatus, type TestReport, logger } from '@xqoder/shared';
import { ProjectTestRunner } from '@xqoder/runtime';

interface TestCommandOptions {
    dir: string;
}

interface TestCommandDependencies {
    testRunnerFactory?: () => Pick<ProjectTestRunner, 'run'>;
}

export async function runTestCommand(
    options: TestCommandOptions,
    dependencies: TestCommandDependencies = {},
): Promise<TestReport> {
    logger.info('🧪 XQoder Test — 项目测试');
    logger.info(`📁 目录: ${options.dir}`);

    const runner = dependencies.testRunnerFactory?.() ?? new ProjectTestRunner();
    const report = await runner.run(options.dir);

    switch (report.status) {
        case TestStatus.Passed:
            logger.success(`测试通过: ${report.passed} passed`);
            break;
        case TestStatus.Skipped:
            logger.warn(report.output);
            break;
        case TestStatus.Failed:
            logger.error(`测试失败: ${report.failed} failed`);
            for (const failure of report.failures) {
                logger.error(`  ${failure.message}`);
            }
            throw new Error(report.failures[0]?.message ?? '测试失败');
    }

    return report;
}

export function createTestCommand(
    dependencies: TestCommandDependencies = {},
): Command {
    return new Command('test')
        .description('运行项目测试并输出结构化结果')
        .option('-d, --dir <dir>', '项目目录', '.')
        .action(async (options: TestCommandOptions) => {
            try {
                await runTestCommand(options, dependencies);
            } catch (err) {
                logger.error(`测试失败: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });
}

export const testCommand = createTestCommand();
