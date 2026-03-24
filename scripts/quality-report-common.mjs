import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeRealProjectEvalReport } from './real-project-eval-report-common.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function formatMetric(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? `${value}` : `${value.toFixed(3)}`;
  }
  if (typeof value === 'boolean') {
    return value ? 'PASS' : 'FAIL';
  }
  if (value === null || value === undefined) {
    return 'n/a';
  }
  return String(value);
}

function readJsonReport(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readHistoryReports(filePath) {
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

function enrichReport(reportDirectory, fileName) {
  const filePath = path.join(reportDirectory, fileName);
  const report = readJsonReport(filePath);
  if (!report || typeof report !== 'object' || !report.slug) {
    return null;
  }

  const historyPath = path.join(reportDirectory, 'history', `${report.slug}.jsonl`);
  const history = readHistoryReports(historyPath)
    .filter((entry) => entry.generatedAt !== report.generatedAt);
  const previous = history[history.length - 1];
  const previousAcceptances = new Map((previous?.acceptance ?? []).map((entry) => [entry.label, entry.actual]));
  const baseName = path.basename(fileName, '.json');

  return {
    ...report,
    fileName,
    sampleCount: history.length + 1,
    acceptance: (report.acceptance ?? []).map((entry) => ({
      ...entry,
      previousActual: previousAcceptances.get(entry.label),
    })),
    markdownLink: `./${baseName}.md`,
    jsonLink: `./${baseName}.json`,
  };
}

function readDirectoryReports(reportDirectory) {
  if (!fs.existsSync(reportDirectory)) {
    return [];
  }

  return fs.readdirSync(reportDirectory)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => enrichReport(reportDirectory, entry))
    .filter((entry) => entry !== null)
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

function summarizeAcceptance(report) {
  const total = report.acceptance?.length ?? 0;
  const passed = (report.acceptance ?? []).filter((entry) => entry.pass).length;
  return {
    passed,
    total,
    label: total === 0 ? 'n/a' : `${passed}/${total} PASS`,
  };
}

function renderReportDirectoryPage({
  title,
  directoryLabel,
  reports,
}) {
  const lines = [
    `# ${title}`,
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Current reports: ${reports.length}`,
    `- Source directory: \`${directoryLabel}\``,
  ];

  if (reports.length === 0) {
    lines.push('', '当前还没有可展示的报告产物。');
    return `${lines.join('\n')}\n`;
  }

  lines.push('', '## Overview', '', '| Report | Generated | Samples | Acceptance | Detail |', '| --- | --- | ---: | --- | --- |');
  for (const report of reports) {
    const acceptance = summarizeAcceptance(report);
    lines.push(`| ${report.title} | ${report.generatedAt} | ${report.sampleCount} | ${acceptance.label} | [markdown](${report.markdownLink}) / [json](${report.jsonLink}) |`);
  }

  for (const report of reports) {
    lines.push(
      '',
      `## ${report.title}`,
      '',
      `- Slug: \`${report.slug}\``,
      `- Generated: ${report.generatedAt}`,
      `- Samples: ${report.sampleCount}`,
      ...(report.summary ? [`- Summary: ${report.summary}`] : []),
    );

    if ((report.acceptance ?? []).length > 0) {
      lines.push('', '### Acceptance', '', '| Check | Target | Actual | Previous | Result |', '| --- | --- | --- | --- | --- |');
      for (const acceptance of report.acceptance) {
        lines.push(`| ${acceptance.label} | ${acceptance.target} | ${acceptance.actual} | ${acceptance.previousActual ?? 'n/a'} | ${acceptance.pass ? 'PASS' : 'FAIL'} |`);
      }
    }

    if ((report.sections ?? []).length > 0) {
      lines.push('', '### Key Metrics', '', '| Section | Metric | Value |', '| --- | --- | ---: |');
      for (const section of report.sections) {
        for (const [metric, value] of Object.entries(section.metrics ?? {})) {
          lines.push(`| ${section.title} | ${metric} | ${formatMetric(value)} |`);
        }
      }
    }

    if (Array.isArray(report.fixtures) && report.fixtures.length > 0) {
      lines.push('', '### Fixture Coverage', '', '| Fixture | Flow | Success Rate | Passed | Failed | p95 (ms) |', '| --- | --- | ---: | ---: | ---: | ---: |');
      for (const fixture of report.fixtures) {
        lines.push(`| ${fixture.id} | ${fixture.flow} | ${formatMetric(fixture.successRate)} | ${fixture.passed} | ${fixture.failed} | ${formatMetric(fixture.latency?.p95)} |`);
      }
    }

    if (Array.isArray(report.projects) && report.projects.length > 0) {
      lines.push('', '### Real Project Coverage', '', '| Project | Runs | Success Rate | Last Run |', '| --- | ---: | ---: | --- |');
      for (const project of report.projects) {
        lines.push(`| ${project.label} | ${project.runs} | ${formatMetric(project.successRate)} | ${project.lastRunAt ?? 'n/a'} |`);
      }
    }

    if (Array.isArray(report.failures) && report.failures.length > 0) {
      lines.push('', '### Failure Buckets', '', '| Reason | Count |', '| --- | ---: |');
      for (const failure of report.failures) {
        lines.push(`| ${failure.reason} | ${failure.count} |`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

export function renderRootQualityPage({ benchmarkReports, evalReports, projectRoot }) {
  const lines = [
    '# Quality Report',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Benchmark reports: ${benchmarkReports.length}`,
    `- Eval reports: ${evalReports.length}`,
    '',
    '## Published Pages',
    '',
    '- [Benchmarks Report](./benchmarks/report.md)',
    '- [Evals Report](./evals/report.md)',
    '- [Real Project Eval](./evals/real-project-results.md)',
    '- [Release Artifact Index](./artifacts/release/latest-index.md)',
    '- [Why XQoder Beats OpenCode](./opencode-comparison.md)',
  ];

  if (benchmarkReports.length > 0) {
    lines.push('', '## Benchmarks Snapshot', '', '| Report | Acceptance | Generated | Detail |', '| --- | --- | --- | --- |');
    for (const report of benchmarkReports) {
      const acceptance = summarizeAcceptance(report);
      lines.push(`| ${report.title} | ${acceptance.label} | ${report.generatedAt} | [report](./benchmarks/report.md) |`);
    }
  }

  if (evalReports.length > 0) {
    lines.push('', '## Evals Snapshot', '', '| Report | Acceptance | Generated | Detail |', '| --- | --- | --- | --- |');
    for (const report of evalReports) {
      const acceptance = summarizeAcceptance(report);
      lines.push(`| ${report.title} | ${acceptance.label} | ${report.generatedAt} | [report](./evals/report.md) |`);
    }
  }

  const releaseArtifactDir = path.join(projectRoot, 'docs', 'artifacts', 'release');
  const workflowParity = readJsonReport(path.join(releaseArtifactDir, 'workflow-parity.json'));
  const releaseState = readJsonReport(path.join(releaseArtifactDir, 'release-state.json'));
  if (workflowParity || releaseState) {
    lines.push('', '## Release Governance Snapshot', '');
    lines.push('- Detail: [Release Artifact Index](./artifacts/release/latest-index.md)');
    lines.push('- Note: Remote workflow/tag data is a point-in-time snapshot. Refresh with `pnpm capture:release:plans` before PR or release decisions.');

    if (workflowParity) {
      lines.push(`- Workflow parity snapshot: \`${workflowParity.generatedAt ?? 'unknown'}\``);
    }

    if (releaseState) {
      lines.push(`- Release state snapshot: \`${releaseState.generatedAt ?? 'unknown'}\``);
      if (typeof releaseState.reference === 'string') {
        lines.push(`- Release reference at snapshot time: \`${releaseState.reference}\``);
      }
      lines.push(`- Expected stable tag at snapshot time: \`${releaseState.stableTag ?? 'n/a'}\``);
      lines.push(`- Latest RC tag at snapshot time: \`${releaseState.latestRcTag ?? 'n/a'}\``);
      if (typeof releaseState.strictGateReady === 'boolean') {
        lines.push(`- Strict gate ready on snapshot reference: \`${releaseState.strictGateReady ? 'yes' : 'no'}\``);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function findReportBySlug(reports, slug) {
  return reports.find((report) => report.slug === slug) ?? null;
}

function readSectionMetric(report, sectionTitle, metric) {
  if (!report || !Array.isArray(report.sections)) {
    return null;
  }
  const section = report.sections.find((candidate) => candidate?.title === sectionTitle);
  const value = section?.metrics?.[metric];
  return typeof value === 'number' ? value : null;
}

function formatMetricCell(value, { digits = 3, suffix = '' } = {}) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }
  return `${value.toFixed(digits)}${suffix}`;
}

function formatCountCell(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }
  return Number.isInteger(value) ? `${value}` : value.toFixed(0);
}

function renderOpenCodeComparisonPage({ benchmarkReports, evalReports }) {
  const daemonStartupReport = findReportBySlug(benchmarkReports, 'daemon-startup');
  const memoryReport = findReportBySlug(benchmarkReports, 'memory-transcript');
  const renderReport = findReportBySlug(benchmarkReports, 'render-transcript');
  const workflowFixtureReport = findReportBySlug(evalReports, 'workflow-fixtures');
  const realProjectReport = findReportBySlug(evalReports, 'real-project-results');

  const workflowFixtureAcceptance = workflowFixtureReport ? summarizeAcceptance(workflowFixtureReport).label : 'n/a';
  const realProjectAcceptance = realProjectReport ? summarizeAcceptance(realProjectReport).label : 'n/a';

  const rustClientColdStartupMs = readSectionMetric(daemonStartupReport, 'Rust Client Startup (ms)', 'cold');
  const rustClientWarmStartupP95Ms = readSectionMetric(daemonStartupReport, 'Rust Client Startup (ms)', 'warmP95');
  const daemonWarmAttachP95Ms = readSectionMetric(daemonStartupReport, 'Daemon Warm Attach (ms)', 'p95');
  const transcriptRebuildP95Ms = readSectionMetric(renderReport, 'Latency (ms)', 'p95');
  const transcriptFrameP95Ms = readSectionMetric(memoryReport, 'Frame Latency (ms)', 'p95');
  const transcriptPeakRssMb = readSectionMetric(memoryReport, 'Memory (MB)', 'peakRssMb');

  const workflowFixtureOverallSuccessRate = readSectionMetric(workflowFixtureReport, 'Overview', 'overallSuccessRate');
  const realProjectTargets = realProjectReport?.meta?.totalProjects;
  const realProjectWorkflowRuns = realProjectReport?.meta?.totalRuns;
  const readyRealProjectTargets = readSectionMetric(realProjectReport, 'Target Readiness', 'readyTargets');
  const blockedRealProjectTargets = readSectionMetric(realProjectReport, 'Target Readiness', 'blockedTargets');
  const projectsWithBuildCoverage = readSectionMetric(realProjectReport, 'Coverage', 'projectsWithBuildCoverage');
  const projectsWithFixCoverage = readSectionMetric(realProjectReport, 'Coverage', 'projectsWithFixCoverage');
  const projectsWithDeployCoverage = readSectionMetric(realProjectReport, 'Coverage', 'projectsWithDeployCoverage');

  const lines = [
    '# Why XQoder Beats OpenCode',
    '',
    '> This page is auto-generated by `pnpm docs:quality:reports` to keep narrative metrics aligned with benchmark/eval evidence.',
    '',
    '这页不是功能列表对打，而是把 XQoder 当前已经公开、可复现、可验证的证据压缩成一页，回答一个更重要的问题：',
    '',
    '为什么说 XQoder 的方向不是“另一个 OpenCode”，而是“更强终端内核 + 更强工程闭环 + 更强可证明质量”。',
    '',
    '## Three Claims',
    '',
    '| 维度 | 当前证据 | 为什么重要 |',
    '| --- | --- | --- |',
    `| 终端内核 | Rust client 冷启动 \`${formatMetricCell(rustClientColdStartupMs, { digits: 3, suffix: 'ms' })}\`、warm p95 \`${formatMetricCell(rustClientWarmStartupP95Ms, { digits: 3, suffix: 'ms' })}\`、daemon warm attach p95 \`${formatMetricCell(daemonWarmAttachP95Ms, { digits: 3, suffix: 'ms' })}\` | 主路径体验是否稳定、够快、可长期演进，取决于底层终端内核而不是 prompt 包装 |`,
    `| 工程闭环 | \`build / fix / test / deploy\` 已有 deterministic fixture eval，\`Workflow Fixture Eval\` 当前 \`${workflowFixtureAcceptance}\` | AI coding assistant 不能只会“说”，还要能形成可回归的工程流 |`,
    `| 质量证据 | 真实项目页当前 \`${formatCountCell(realProjectTargets)}\` 个目标、\`${formatCountCell(realProjectWorkflowRuns)}\` 次 workflow run、deploy 覆盖 \`${formatCountCell(projectsWithDeployCoverage)}\`、\`${realProjectAcceptance}\`；Benchmark/Eval 页面均已公开 | 对外叙事不靠形容词，靠可重复运行的数据页面 |`,
    '',
    '## Public Metrics',
    '',
    '### Runtime And Rendering',
    '',
    '| 指标 | 当前值 | 来源 |',
    '| --- | ---: | --- |',
    `| Rust client cold startup | \`${formatMetricCell(rustClientColdStartupMs, { digits: 3, suffix: 'ms' })}\` | [\`docs/benchmarks/report.md\`](./benchmarks/report.md) |`,
    `| Rust client warm startup p95 | \`${formatMetricCell(rustClientWarmStartupP95Ms, { digits: 3, suffix: 'ms' })}\` | [\`docs/benchmarks/report.md\`](./benchmarks/report.md) |`,
    `| daemon warm attach p95 | \`${formatMetricCell(daemonWarmAttachP95Ms, { digits: 3, suffix: 'ms' })}\` | [\`docs/benchmarks/report.md\`](./benchmarks/report.md) |`,
    `| transcript rebuild p95 | \`${formatMetricCell(transcriptRebuildP95Ms, { digits: 3, suffix: 'ms' })}\` | [\`docs/benchmarks/report.md\`](./benchmarks/report.md) |`,
    `| transcript frame latency p95 | \`${formatMetricCell(transcriptFrameP95Ms, { digits: 3, suffix: 'ms' })}\` | [\`docs/benchmarks/report.md\`](./benchmarks/report.md) |`,
    `| transcript peak RSS | \`${formatMetricCell(transcriptPeakRssMb, { digits: 2, suffix: 'MB' })}\` | [\`docs/benchmarks/report.md\`](./benchmarks/report.md) |`,
    '',
    '### Workflow Reliability',
    '',
    '| 指标 | 当前值 | 来源 |',
    '| --- | ---: | --- |',
    `| Workflow fixture acceptance | \`${workflowFixtureAcceptance}\` | [\`docs/evals/report.md\`](./evals/report.md) |`,
    `| Workflow fixture overall success rate | \`${formatMetricCell(workflowFixtureOverallSuccessRate, { digits: 1 })}\` | [\`docs/evals/report.md\`](./evals/report.md) |`,
    `| Real-project acceptance | \`${realProjectAcceptance}\` | [\`docs/evals/report.md\`](./evals/report.md) |`,
    `| Real-project targets | \`${formatCountCell(realProjectTargets)}\` | [\`docs/evals/real-project-results.md\`](./evals/real-project-results.md) |`,
    `| Real-project workflow runs | \`${formatCountCell(realProjectWorkflowRuns)}\` | [\`docs/evals/real-project-results.md\`](./evals/real-project-results.md) |`,
    `| Ready real-project targets | \`${formatCountCell(readyRealProjectTargets)}\` | [\`docs/evals/real-project-results.md\`](./evals/real-project-results.md) |`,
    `| Blocked real-project targets | \`${formatCountCell(blockedRealProjectTargets)}\` | [\`docs/evals/real-project-results.md\`](./evals/real-project-results.md) |`,
    `| Projects with build coverage | \`${formatCountCell(projectsWithBuildCoverage)}\` | [\`docs/evals/real-project-results.md\`](./evals/real-project-results.md) |`,
    `| Projects with fix coverage | \`${formatCountCell(projectsWithFixCoverage)}\` | [\`docs/evals/real-project-results.md\`](./evals/real-project-results.md) |`,
    `| Projects with deploy coverage | \`${formatCountCell(projectsWithDeployCoverage)}\` | [\`docs/evals/real-project-results.md\`](./evals/real-project-results.md) |`,
    '',
    '## Why This Is Different',
    '',
    '1. XQoder 的重点不是把更多命令堆到 CLI，而是让 Rust client、daemon、workflow、session、quality gate 形成一个能长期复用的系统。',
    '2. `fix` 和 `deploy` 都不只是一次性 demo。现在真实项目页已经能公开展示 `test`、deterministic `fix drill` 与 deterministic `deploy drill` 覆盖，且这些记录直接来自正式 workflow history。',
    '3. benchmark、eval、release gate、golden test 这些证据已经接成统一页面，意味着“好不好”可以持续比较，而不是每次发布重新讲故事。',
    '',
    '## Honest Gaps',
    '',
    '- 真实项目样本仍以本仓库 workspace package 为主，外部开源仓库样本还需要继续扩展。',
    '- 真实项目页已有 deterministic `build / deploy` 覆盖，但跨语言、跨框架的大样本仍需继续补齐。',
    '- Windows 仍处于 Node CLI preview 路径，Rust client 主路径还没正式拉齐。',
    '',
    '## Reading Path',
    '',
    '- 总览入口：[`docs/quality-report.md`](./quality-report.md)',
    '- Benchmark 总览：[`docs/benchmarks/report.md`](./benchmarks/report.md)',
    '- Eval 总览：[`docs/evals/report.md`](./evals/report.md)',
    '- 真实项目页：[`docs/evals/real-project-results.md`](./evals/real-project-results.md)',
    '- 路线图：[`XQoder-12周推进路线图-2026-03-22.md`](../XQoder-12周推进路线图-2026-03-22.md)',
    '',
  ];

  return lines.join('\n');
}

export function writeQualityOverviewReports(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? repoRoot);
  const docsDir = path.join(projectRoot, 'docs');
  const benchmarksDir = path.join(docsDir, 'benchmarks');
  const evalsDir = path.join(docsDir, 'evals');
  const workflowHistoryPath = path.resolve(options.workflowHistoryPath ?? path.join(process.env.HOME ?? '', '.xqoder', 'data', 'workflow-history.jsonl'));
  const targetsPath = path.join(evalsDir, 'real-project-targets.json');

  writeRealProjectEvalReport({
    projectRoot,
    workflowHistoryPath,
    ...(fs.existsSync(targetsPath) ? { targetsPath } : {}),
  });

  const benchmarkReports = readDirectoryReports(benchmarksDir);
  const evalReports = readDirectoryReports(evalsDir);

  fs.mkdirSync(benchmarksDir, { recursive: true });
  fs.mkdirSync(evalsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const benchmarkOverviewPath = path.join(benchmarksDir, 'report.md');
  const evalOverviewPath = path.join(evalsDir, 'report.md');
  const rootOverviewPath = path.join(docsDir, 'quality-report.md');
  const comparisonPath = path.join(docsDir, 'opencode-comparison.md');

  fs.writeFileSync(benchmarkOverviewPath, renderReportDirectoryPage({
    title: 'Benchmarks Report',
    directoryLabel: 'docs/benchmarks',
    reports: benchmarkReports,
  }), 'utf8');
  fs.writeFileSync(evalOverviewPath, renderReportDirectoryPage({
    title: 'Evals Report',
    directoryLabel: 'docs/evals',
    reports: evalReports,
  }), 'utf8');
  fs.writeFileSync(rootOverviewPath, renderRootQualityPage({
    benchmarkReports,
    evalReports,
    projectRoot,
  }), 'utf8');
  fs.writeFileSync(comparisonPath, renderOpenCodeComparisonPage({
    benchmarkReports,
    evalReports,
  }), 'utf8');

  return {
    benchmarkOverviewPath,
    evalOverviewPath,
    rootOverviewPath,
    comparisonPath,
  };
}
