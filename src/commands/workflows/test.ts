// ============================================================
// xqoder test — Run project tests
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
    logger.info('🧪 XQoder Test — Project Testing');
    logger.info(`📁 Directory: ${options.dir}`);

    const runner = dependencies.testRunnerFactory?.() ?? new ProjectTestRunner();
    const report = await runner.run(options.dir);

    switch (report.status) {
        case TestStatus.Passed:
            logger.success(`Test passed: ${report.passed} passed`);
            break;
        case TestStatus.Skipped:
            logger.warn(report.output);
            break;
        case TestStatus.Failed:
            logger.error(`Test failed: ${report.failed} failed`);
            for (const failure of report.failures) {
                logger.error(`  ${failure.message}`);
            }
            throw new Error(report.failures[0]?.message ?? 'Test failed');
    }

    return report;
}

export function createTestCommand(
    dependencies: TestCommandDependencies = {},
): Command {
    return new Command('test')
        .description('Run project tests and output structured results')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .action(async (options: TestCommandOptions) => {
            try {
                await runTestCommand(options, dependencies);
            } catch (err) {
                logger.error(`Test failed: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });
}

export const testCommand = createTestCommand();
