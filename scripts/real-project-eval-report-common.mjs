import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { evaluateRealProjectTargetReadiness, readRealProjectTargets } from './real-project-targets-common.mjs';

const ROADMAP_TARGET_PROJECTS = 5;
const ROADMAP_TARGET_RUNS = 15;
const ROADMAP_TARGET_BUILD_PROJECTS = 5;
const ROADMAP_TARGET_FIX_PROJECTS = 5;
const ROADMAP_TARGET_DEPLOY_PROJECTS = 5;
const ROADMAP_MIN_SUCCESS_RATE = 0.6;
const FIX_DRILL_MARKER = '.xqoder/real-project-fix-drill.json';

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function isWorkflowRunRecord(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.id === 'string'
    && (value.flow === 'build' || value.flow === 'fix' || value.flow === 'test' || value.flow === 'deploy')
    && typeof value.projectRoot === 'string'
    && typeof value.projectName === 'string'
    && typeof value.success === 'boolean'
    && typeof value.completedAt === 'string'
    && typeof value.totalDurationMs === 'number';
}

function isTemporaryProjectRoot(projectRoot) {
  const normalized = path.resolve(projectRoot);
  const tempRoots = [
    path.resolve(os.tmpdir()),
    '/tmp',
    '/private/tmp',
  ].map((root) => path.resolve(root));

  if (tempRoots.some((root) => normalized === root || normalized.startsWith(`${root}${path.sep}`))) {
    return true;
  }

  return /[/\\]var[/\\]folders[/\\].+[/\\]T(?:[/\\]|$)/.test(normalized);
}

function isFixtureLikeProject(record) {
  const haystack = `${record.projectRoot} ${record.projectName}`.toLowerCase();
  return haystack.includes('xqoder-fixture')
    || haystack.includes('__fixtures__')
    || haystack.includes('fixture-')
    || haystack.includes('fixture_')
    || haystack.includes('xqoder-fix-');
}

function selectRecords(records, options) {
  const targets = options.targetsPath
    ? readRealProjectTargets(options.targetsPath, { allowMissing: true, allowEmpty: true })
    : [];
  const targetByRoot = new Map(targets.map((target) => [path.resolve(target.projectRoot), target]));

  if (targets.length > 0) {
    return {
      selectionMode: 'targets',
      targets,
      records: records.filter((record) => targetByRoot.has(path.resolve(record.projectRoot))),
      targetByRoot,
    };
  }

  return {
    selectionMode: 'auto',
    targets,
    records: records.filter((record) => {
      if (isFixtureLikeProject(record)) {
        return false;
      }
      if (!options.includeTemp && isTemporaryProjectRoot(record.projectRoot)) {
        return false;
      }
      return true;
    }),
    targetByRoot,
  };
}

function summarizeFlow(records, flow) {
  const filtered = records.filter((record) => record.flow === flow);
  const successfulRuns = filtered.filter((record) => record.success).length;
  const totalDurationMs = filtered.reduce((sum, record) => sum + record.totalDurationMs, 0);
  return {
    flow,
    runs: filtered.length,
    successfulRuns,
    failedRuns: filtered.length - successfulRuns,
    successRate: filtered.length === 0 ? 0 : round(successfulRuns / filtered.length),
    avgDurationMs: filtered.length === 0 ? 0 : round(totalDurationMs / filtered.length, 1),
  };
}

function summarizeProjects(records, targetByRoot) {
  const grouped = new Map();
  for (const record of records) {
    const key = path.resolve(record.projectRoot);
    const bucket = grouped.get(key) ?? [];
    bucket.push(record);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .map(([projectRoot, projectRecords]) => {
      const target = targetByRoot.get(projectRoot);
      const successfulRuns = projectRecords.filter((record) => record.success).length;
      const failureBuckets = new Map();
      const models = new Set();
      const agents = new Set();
      const commands = new Set();

      for (const record of projectRecords) {
        if (!record.success && record.failureBucket) {
          failureBuckets.set(record.failureBucket, (failureBuckets.get(record.failureBucket) ?? 0) + 1);
        }
        if (typeof record.model === 'string' && record.model.trim().length > 0) {
          models.add(record.model.trim());
        }
        if (typeof record.agent === 'string' && record.agent.trim().length > 0) {
          agents.add(record.agent.trim());
        }
        if (typeof record.command === 'string' && record.command.trim().length > 0) {
          commands.add(record.command.trim());
        }
      }

      const flows = ['build', 'fix', 'test', 'deploy'].map((flow) => summarizeFlow(projectRecords, flow));
      const firstRunAt = [...projectRecords]
        .sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt))[0]?.completedAt;
      const lastRunAt = [...projectRecords]
        .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))[0]?.completedAt;

      return {
        id: target?.id ?? path.basename(projectRoot),
        label: target?.label ?? path.basename(projectRoot),
        projectRoot,
        ...(target?.repo ? { repo: target.repo } : {}),
        ...(target?.notes ? { notes: target.notes } : {}),
        runs: projectRecords.length,
        successfulRuns,
        failedRuns: projectRecords.length - successfulRuns,
        successRate: projectRecords.length === 0 ? 0 : round(successfulRuns / projectRecords.length),
        firstRunAt,
        lastRunAt,
        flowCoverage: flows,
        failureBuckets: [...failureBuckets.entries()]
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .map(([bucket, count]) => ({ bucket, count })),
        models: [...models].sort(),
        agents: [...agents].sort(),
        commands: [...commands].sort(),
      };
    })
    .sort((left, right) => right.runs - left.runs || String(right.lastRunAt).localeCompare(String(left.lastRunAt)));
}

function summarizeTargetInventory(targets, projects) {
  const projectByRoot = new Map(projects.map((project) => [path.resolve(project.projectRoot), project]));

  return targets.map((target) => {
    const readiness = evaluateRealProjectTargetReadiness(target);
    const project = projectByRoot.get(path.resolve(target.projectRoot));
    const flowCoverage = project?.flowCoverage ?? [];
    return {
      id: target.id,
      label: target.label,
      enabled: target.enabled !== false,
      readiness: readiness.readiness,
      blockers: readiness.blockers,
      projectRoot: target.projectRoot,
      ...(target.checkoutRoot ? { checkoutRoot: target.checkoutRoot } : {}),
      ...(target.repo ? { repo: target.repo } : {}),
      ...(target.scenarios ? { scenarios: target.scenarios } : {}),
      ...(target.requiredCommands ? { requiredCommands: target.requiredCommands } : {}),
      ...(target.requiredEnv ? { requiredEnv: target.requiredEnv } : {}),
      ...(target.requiredPaths ? { requiredPaths: target.requiredPaths } : {}),
      ...(target.readinessChecks ? { readinessChecks: target.readinessChecks } : {}),
      ...(target.notes ? { notes: target.notes } : {}),
      runs: project?.runs ?? 0,
      coverage: {
        build: flowCoverage.find((item) => item.flow === 'build')?.runs ?? 0,
        fix: flowCoverage.find((item) => item.flow === 'fix')?.runs ?? 0,
        test: flowCoverage.find((item) => item.flow === 'test')?.runs ?? 0,
        deploy: flowCoverage.find((item) => item.flow === 'deploy')?.runs ?? 0,
      },
    };
  });
}

function buildMarkdown(report) {
  const lines = [
    `# ${report.title}`,
    '',
    `- Generated: ${report.generatedAt}`,
    `- Summary: ${report.summary}`,
    `- Selection mode: ${report.meta.selectionMode}`,
    `- Workflow history: ${report.meta.workflowHistoryPath}`,
    `- Real projects: ${report.meta.totalProjects}`,
    `- Real-project runs: ${report.meta.totalRuns}`,
  ];

  if (report.meta.targetsPath) {
    lines.push(`- Targets file: ${report.meta.targetsPath}`);
  }

  if (typeof report.meta.declaredTargets === 'number') {
    lines.push(`- Declared targets: ${report.meta.declaredTargets}`);
    lines.push(`- Ready targets now: ${report.meta.readyTargets}`);
    lines.push(`- Sync-needed targets: ${report.meta.syncNeededTargets}`);
    lines.push(`- Blocked targets: ${report.meta.blockedTargets}`);
    lines.push(`- Disabled targets: ${report.meta.disabledTargets}`);
  }

  lines.push(
    '',
    '## Roadmap Targets',
    '',
    `- Projects: ${ROADMAP_TARGET_PROJECTS}`,
    `- Runs: ${ROADMAP_TARGET_RUNS}`,
    `- Projects with build coverage: ${ROADMAP_TARGET_BUILD_PROJECTS}`,
    `- Projects with fix coverage: ${ROADMAP_TARGET_FIX_PROJECTS}`,
    `- Projects with deploy coverage: ${ROADMAP_TARGET_DEPLOY_PROJECTS}`,
  );
  lines.push(
    '',
    '## Evaluation Protocol',
    '',
    '- `build` coverage comes from a deterministic build drill: the runner executes the official `runBuildCommand` flow with an injected no-op generator, then validates the target with its real test suite.',
    '- `test` coverage comes from `xqoder test --dir <projectRoot>` runs against each declared target.',
    `- \`fix\` coverage comes from a deterministic fix drill: the runner writes a temporary \`${FIX_DRILL_MARKER}\` marker, executes the official \`runFixCommand\` flow with injected repair logic, and validates the result with the target project's real test suite.`,
    '- `deploy` coverage comes from a deterministic deploy drill: the runner executes the official `runDeployCommand` flow with a local deployer that runs the target build command and validates the declared output directory without touching a real cloud account.',
  );

  lines.push('', '## Acceptance', '', '| Check | Target | Actual | Result |', '| --- | --- | --- | --- |');
  for (const item of report.acceptance ?? []) {
    lines.push(`| ${item.label} | ${item.target} | ${item.actual} | ${item.pass ? 'PASS' : 'FAIL'} |`);
  }

  lines.push('', '## Overview', '', '| Metric | Value |', '| --- | ---: |');
  for (const section of report.sections ?? []) {
    for (const [metric, value] of Object.entries(section.metrics ?? {})) {
      lines.push(`| ${section.title} / ${metric} | ${value} |`);
    }
  }

  if (Array.isArray(report.targets) && report.targets.length > 0) {
    lines.push('', '## Target Readiness', '', '| Target | Enabled | Readiness | Runs | Build | Fix | Test | Deploy | Requirements |');
    lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const target of report.targets) {
      const requirements = [
        ...(target.requiredCommands?.length ? [`cmd=${target.requiredCommands.join(',')}`] : []),
        ...(target.requiredEnv?.length ? [`env=${target.requiredEnv.join(',')}`] : []),
        ...(target.requiredPaths?.length ? [`paths=${target.requiredPaths.map((candidatePath) => path.basename(candidatePath)).join(',')}`] : []),
        ...(target.readinessChecks?.length ? [`checks=${target.readinessChecks.map((check) => check.label).join(',')}`] : []),
        ...(target.blockers?.length ? [`blocked: ${target.blockers.join('; ')}`] : []),
      ].join(' | ') || 'n/a';
      lines.push(`| ${target.label} | ${target.enabled ? 'yes' : 'no'} | ${target.readiness} | ${target.runs} | ${target.coverage.build} | ${target.coverage.fix} | ${target.coverage.test} | ${target.coverage.deploy} | ${requirements} |`);
    }
  }

  if (!Array.isArray(report.projects) || report.projects.length === 0) {
    lines.push(
      '',
      '## Status',
      '',
      '当前还没有检测到符合条件的真实项目运行记录。',
      '',
      '- 自动模式会排除 `/tmp`、系统临时目录、fixture 项目和 `xqoder-fix-*` 临时工程。',
      '- 如果你要纳入指定本地仓库，可以创建 `docs/evals/real-project-targets.json` 并显式声明项目根目录。',
    );
    return `${lines.join('\n')}\n`;
  }

  lines.push('', '## Project Coverage', '', '| Project | Runs | Success Rate | Build | Fix | Test | Deploy | Last Run |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const project of report.projects) {
    const build = project.flowCoverage.find((item) => item.flow === 'build')?.runs ?? 0;
    const fix = project.flowCoverage.find((item) => item.flow === 'fix')?.runs ?? 0;
    const test = project.flowCoverage.find((item) => item.flow === 'test')?.runs ?? 0;
    const deploy = project.flowCoverage.find((item) => item.flow === 'deploy')?.runs ?? 0;
    lines.push(`| ${project.label} | ${project.runs} | ${project.successRate} | ${build} | ${fix} | ${test} | ${deploy} | ${project.lastRunAt ?? 'n/a'} |`);
  }

  for (const project of report.projects) {
    lines.push(
      '',
      `## ${project.label}`,
      '',
      `- Root: ${project.projectRoot}`,
      `- Runs: ${project.runs}`,
      `- Success rate: ${project.successRate}`,
      `- First run: ${project.firstRunAt ?? 'n/a'}`,
      `- Last run: ${project.lastRunAt ?? 'n/a'}`,
      ...(project.repo ? [`- Repo: ${project.repo}`] : []),
      ...(project.notes ? [`- Notes: ${project.notes}`] : []),
      ...(project.models.length > 0 ? [`- Models: ${project.models.join(', ')}`] : []),
      ...(project.agents.length > 0 ? [`- Agents: ${project.agents.join(', ')}`] : []),
    );

    lines.push('', '### Flow Breakdown', '', '| Flow | Runs | Success Rate | Avg Duration (ms) |', '| --- | ---: | ---: | ---: |');
    for (const flow of project.flowCoverage) {
      lines.push(`| ${flow.flow} | ${flow.runs} | ${flow.successRate} | ${flow.avgDurationMs} |`);
    }

    if (project.failureBuckets.length > 0) {
      lines.push('', '### Failure Buckets', '', '| Bucket | Count |', '| --- | ---: |');
      for (const failure of project.failureBuckets) {
        lines.push(`| ${failure.bucket} | ${failure.count} |`);
      }
    }

    if (project.commands.length > 0) {
      lines.push('', '### Observed Commands', '');
      for (const command of project.commands.slice(0, 5)) {
        lines.push(`- \`${command}\``);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

export function buildRealProjectEvalReport(options) {
  const workflowHistoryPath = path.resolve(options.workflowHistoryPath);
  const targetsPath = options.targetsPath ? path.resolve(options.targetsPath) : undefined;
  const allRecords = readJsonl(workflowHistoryPath).filter(isWorkflowRunRecord);
  const selection = selectRecords(allRecords, {
    includeTemp: options.includeTemp ?? false,
    targetsPath,
  });
  const selectedRecords = selection.records.sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
  const projects = summarizeProjects(selectedRecords, selection.targetByRoot);
  const targetInventory = summarizeTargetInventory(selection.targets, projects);
  const successfulRuns = selectedRecords.filter((record) => record.success).length;
  const failureBuckets = new Map();

  for (const record of selectedRecords) {
    if (!record.success && record.failureBucket) {
      failureBuckets.set(record.failureBucket, (failureBuckets.get(record.failureBucket) ?? 0) + 1);
    }
  }

  const flowSummaries = ['build', 'fix', 'test', 'deploy'].map((flow) => summarizeFlow(selectedRecords, flow));
  const projectsWithBuildCoverage = projects.filter((project) => (project.flowCoverage.find((item) => item.flow === 'build')?.runs ?? 0) > 0).length;
  const projectsWithFixCoverage = projects.filter((project) => (project.flowCoverage.find((item) => item.flow === 'fix')?.runs ?? 0) > 0).length;
  const projectsWithDeployCoverage = projects.filter((project) => (project.flowCoverage.find((item) => item.flow === 'deploy')?.runs ?? 0) > 0).length;
  const overallSuccessRate = selectedRecords.length === 0 ? 0 : round(successfulRuns / selectedRecords.length);
  const readyTargets = targetInventory.filter((target) => target.readiness === 'ready').length;
  const syncNeededTargets = targetInventory.filter((target) => target.readiness === 'sync-needed').length;
  const blockedTargets = targetInventory.filter((target) => target.readiness === 'blocked').length;
  const disabledTargets = targetInventory.filter((target) => !target.enabled).length;

  return {
    slug: 'real-project-results',
    title: 'Real Project Workflow Eval',
    generatedAt: new Date().toISOString(),
    summary: 'Aggregates workflow-history records for non-fixture projects and tracks progress toward the roadmap goal of publishing reproducible real-project build/test/fix/deploy coverage.',
    meta: {
      workflowHistoryPath,
      ...(targetsPath ? { targetsPath } : {}),
      selectionMode: selection.selectionMode,
      totalProjects: projects.length,
      totalRuns: selectedRecords.length,
      declaredTargets: targetInventory.length,
      readyTargets,
      syncNeededTargets,
      blockedTargets,
      disabledTargets,
      roadmapTargetProjects: ROADMAP_TARGET_PROJECTS,
      roadmapTargetRuns: ROADMAP_TARGET_RUNS,
      roadmapTargetBuildProjects: ROADMAP_TARGET_BUILD_PROJECTS,
      roadmapTargetFixProjects: ROADMAP_TARGET_FIX_PROJECTS,
      roadmapTargetDeployProjects: ROADMAP_TARGET_DEPLOY_PROJECTS,
    },
    sections: [
      {
        title: 'Overview',
        metrics: {
          totalProjects: projects.length,
          totalRuns: selectedRecords.length,
          successfulRuns,
          failedRuns: selectedRecords.length - successfulRuns,
          overallSuccessRate,
        },
      },
      {
        title: 'Flow Success Rate',
        metrics: {
          buildSuccessRate: flowSummaries.find((item) => item.flow === 'build')?.successRate ?? 0,
          fixSuccessRate: flowSummaries.find((item) => item.flow === 'fix')?.successRate ?? 0,
          testSuccessRate: flowSummaries.find((item) => item.flow === 'test')?.successRate ?? 0,
          deploySuccessRate: flowSummaries.find((item) => item.flow === 'deploy')?.successRate ?? 0,
        },
      },
      {
        title: 'Coverage',
        metrics: {
          projectsWithBuildCoverage,
          projectsWithFixCoverage,
          projectsWithTestCoverage: projects.filter((project) => (project.flowCoverage.find((item) => item.flow === 'test')?.runs ?? 0) > 0).length,
          projectsWithDeployCoverage,
        },
      },
      {
        title: 'Target Readiness',
        metrics: {
          declaredTargets: targetInventory.length,
          readyTargets,
          syncNeededTargets,
          blockedTargets,
          disabledTargets,
        },
      },
    ],
    targets: targetInventory,
    projects,
    failures: [...failureBuckets.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([reason, count]) => ({ reason, count })),
    acceptance: [
      {
        label: 'Captured real projects',
        target: `>= ${ROADMAP_TARGET_PROJECTS}`,
        actual: `${projects.length}`,
        pass: projects.length >= ROADMAP_TARGET_PROJECTS,
      },
      {
        label: 'Captured real-project workflow runs',
        target: `>= ${ROADMAP_TARGET_RUNS}`,
        actual: `${selectedRecords.length}`,
        pass: selectedRecords.length >= ROADMAP_TARGET_RUNS,
      },
      {
        label: 'Projects with build coverage',
        target: `>= ${ROADMAP_TARGET_BUILD_PROJECTS}`,
        actual: `${projectsWithBuildCoverage}`,
        pass: projectsWithBuildCoverage >= ROADMAP_TARGET_BUILD_PROJECTS,
      },
      {
        label: 'Projects with fix coverage',
        target: `>= ${ROADMAP_TARGET_FIX_PROJECTS}`,
        actual: `${projectsWithFixCoverage}`,
        pass: projectsWithFixCoverage >= ROADMAP_TARGET_FIX_PROJECTS,
      },
      {
        label: 'Projects with deploy coverage',
        target: `>= ${ROADMAP_TARGET_DEPLOY_PROJECTS}`,
        actual: `${projectsWithDeployCoverage}`,
        pass: projectsWithDeployCoverage >= ROADMAP_TARGET_DEPLOY_PROJECTS,
      },
      {
        label: 'Overall success rate',
        target: `>= ${ROADMAP_MIN_SUCCESS_RATE}`,
        actual: `${overallSuccessRate}`,
        pass: overallSuccessRate >= ROADMAP_MIN_SUCCESS_RATE,
      },
    ],
  };
}

export function writeRealProjectEvalReport(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const evalsDir = path.join(projectRoot, 'docs', 'evals');
  fs.mkdirSync(evalsDir, { recursive: true });

  const report = buildRealProjectEvalReport({
    workflowHistoryPath: options.workflowHistoryPath,
    ...(options.targetsPath ? { targetsPath: options.targetsPath } : {}),
    ...(options.includeTemp !== undefined ? { includeTemp: options.includeTemp } : {}),
  });

  const jsonPath = path.join(evalsDir, 'real-project-results.json');
  const markdownPath = path.join(evalsDir, 'real-project-results.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, buildMarkdown(report), 'utf8');

  return {
    jsonPath,
    markdownPath,
    report,
  };
}
