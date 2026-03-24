#!/usr/bin/env node

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { repoRoot } from './benchmark-common.mjs';

const AUTOMATIC_ACTION_PROMOTION_MIN_RUNS = 3;
const AUTOMATIC_ACTION_PROMOTION_MIN_SUCCESS_RATE = 0.8;
const AUTOMATIC_ACTION_PROMOTION_MAX_FAILED_RUNS = 1;

function parseArgs(argv) {
  const readValue = (name, fallback) => {
    const index = argv.findIndex((token) => token === `--${name}` || token.startsWith(`--${name}=`));
    if (index === -1) {
      return fallback;
    }
    const token = argv[index];
    if (token.includes('=')) {
      return token.split('=').slice(1).join('=');
    }
    return argv[index + 1] ?? fallback;
  };

  return {
    projectRoot: path.resolve(readValue('project-root', repoRoot)),
    output: readValue('output', ''),
    workflowHistory: path.resolve(readValue('workflow-history', path.join(os.homedir(), '.xqoder', 'data', 'workflow-history.jsonl'))),
  };
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

function readTrendReport(directory, filePath) {
  const current = readJsonReport(filePath);
  if (!current || !current.slug) {
    return null;
  }

  const historyPath = path.join(directory, 'history', `${current.slug}.jsonl`);
  const history = readHistoryReports(historyPath)
    .filter((entry) => entry.generatedAt !== current.generatedAt);
  const previous = history[history.length - 1];
  const previousAcceptances = new Map((previous?.acceptance ?? []).map((entry) => [entry.label, entry.actual]));

  return {
    slug: current.slug,
    title: current.title,
    generatedAt: current.generatedAt,
    summary: current.summary,
    sampleCount: history.length + 1,
    acceptances: (current.acceptance ?? []).map((entry) => ({
      ...entry,
      ...(previousAcceptances.has(entry.label)
        ? { previousActual: previousAcceptances.get(entry.label) }
        : {}),
    })),
  };
}

function readReportDirectory(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readTrendReport(directory, path.join(directory, entry)))
    .filter(Boolean);
}

function readProjectBenchmarkInsights(projectRoot) {
  return {
    reports: [
      ...readReportDirectory(path.join(projectRoot, 'docs', 'benchmarks')),
      ...readReportDirectory(path.join(projectRoot, 'docs', 'evals')),
    ].sort((left, right) => left.slug.localeCompare(right.slug)),
  };
}

function readWorkflowHistoryRecords(filePath, projectRoot) {
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
    })
    .filter((record) => !projectRoot || record.projectRoot === projectRoot)
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
}

function roundSuccessRate(successfulRuns, totalRuns) {
  if (totalRuns === 0) {
    return 0;
  }
  return Number((successfulRuns / totalRuns).toFixed(4));
}

function summarizeWorkflowWindow(label, days, runs, now) {
  const cutoff = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
  const filtered = runs.filter((run) => Date.parse(run.completedAt) >= cutoff.getTime());
  const successfulRuns = filtered.filter((run) => run.success).length;
  return {
    label,
    totalRuns: filtered.length,
    successfulRuns,
    failedRuns: filtered.length - successfulRuns,
    successRate: roundSuccessRate(successfulRuns, filtered.length),
  };
}

function summarizeWorkflowHistory(filePath, projectRoot) {
  const runs = readWorkflowHistoryRecords(filePath, projectRoot);
  if (runs.length === 0) {
    return null;
  }

  const successfulRuns = runs.filter((run) => run.success).length;
  const failedRuns = runs.length - successfulRuns;
  const byFlow = new Map();
  const failureBuckets = new Map();
  const policyPerformance = new Map();
  const policyBucketPerformance = new Map();
  const automaticActionPerformance = new Map();
  const automaticActionBucketPerformance = new Map();

  for (const run of runs) {
    const flow = byFlow.get(run.flow) ?? {
      flow: run.flow,
      count: 0,
      successfulRuns: 0,
      failedRuns: 0,
      totalDurationMs: 0,
    };
    flow.count += 1;
    flow.totalDurationMs += run.totalDurationMs;
    if (run.success) {
      flow.successfulRuns += 1;
    } else {
      flow.failedRuns += 1;
      const bucket = run.failureBucket ?? 'unknown_failure';
      failureBuckets.set(bucket, (failureBuckets.get(bucket) ?? 0) + 1);
    }
    byFlow.set(run.flow, flow);

    const policyIds = [...new Set(run.remediationPolicyIds ?? [])];
    const automaticActionIds = [...new Set(run.automaticActionIds ?? [])];
    const suspectedFailureBuckets = [...new Set(run.suspectedFailureBuckets ?? [])];

    for (const policyId of policyIds) {
      const policyEntry = policyPerformance.get(policyId) ?? {
        policyId,
        count: 0,
        successfulRuns: 0,
        failedRuns: 0,
      };
      policyEntry.count += 1;
      if (run.success) {
        policyEntry.successfulRuns += 1;
      } else {
        policyEntry.failedRuns += 1;
      }
      policyPerformance.set(policyId, policyEntry);

      for (const bucket of suspectedFailureBuckets) {
        const compositeKey = `${policyId}::${bucket}`;
        const policyBucketEntry = policyBucketPerformance.get(compositeKey) ?? {
          policyId,
          bucket,
          count: 0,
          successfulRuns: 0,
          failedRuns: 0,
        };
        policyBucketEntry.count += 1;
        if (run.success) {
          policyBucketEntry.successfulRuns += 1;
        } else {
          policyBucketEntry.failedRuns += 1;
        }
        policyBucketPerformance.set(compositeKey, policyBucketEntry);
      }
    }

    for (const actionId of automaticActionIds) {
      const actionEntry = automaticActionPerformance.get(actionId) ?? {
        actionId,
        count: 0,
        successfulRuns: 0,
        failedRuns: 0,
      };
      actionEntry.count += 1;
      if (run.success) {
        actionEntry.successfulRuns += 1;
      } else {
        actionEntry.failedRuns += 1;
      }
      automaticActionPerformance.set(actionId, actionEntry);

      for (const bucket of suspectedFailureBuckets) {
        const compositeKey = `${actionId}::${bucket}`;
        const actionBucketEntry = automaticActionBucketPerformance.get(compositeKey) ?? {
          actionId,
          bucket,
          count: 0,
          successfulRuns: 0,
          failedRuns: 0,
        };
        actionBucketEntry.count += 1;
        if (run.success) {
          actionBucketEntry.successfulRuns += 1;
        } else {
          actionBucketEntry.failedRuns += 1;
        }
        automaticActionBucketPerformance.set(compositeKey, actionBucketEntry);
      }
    }
  }

  return {
    totalRuns: runs.length,
    successfulRuns,
    failedRuns,
    successRate: roundSuccessRate(successfulRuns, runs.length),
    rollingWindows: [
      summarizeWorkflowWindow('7d', 7, runs, new Date()),
      summarizeWorkflowWindow('30d', 30, runs, new Date()),
    ],
    byFlow: [...byFlow.values()].map((entry) => ({
      ...entry,
      successRate: roundSuccessRate(entry.successfulRuns, entry.count),
      avgDurationMs: entry.count > 0 ? Number((entry.totalDurationMs / entry.count).toFixed(1)) : 0,
    })),
    failureBuckets: [...failureBuckets.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([bucket, count]) => ({ bucket, count })),
    policyPerformance: [...policyPerformance.values()]
      .map((entry) => ({
        ...entry,
        successRate: roundSuccessRate(entry.successfulRuns, entry.count),
      }))
      .sort((left, right) => right.count - left.count || left.policyId.localeCompare(right.policyId)),
    policyBucketPerformance: [...policyBucketPerformance.values()]
      .map((entry) => ({
        ...entry,
        successRate: roundSuccessRate(entry.successfulRuns, entry.count),
      }))
      .sort((left, right) => right.count - left.count || left.policyId.localeCompare(right.policyId) || left.bucket.localeCompare(right.bucket)),
    automaticActionPerformance: [...automaticActionPerformance.values()]
      .map((entry) => ({
        ...entry,
        successRate: roundSuccessRate(entry.successfulRuns, entry.count),
      }))
      .sort((left, right) => right.count - left.count || left.actionId.localeCompare(right.actionId)),
    automaticActionBucketPerformance: [...automaticActionBucketPerformance.values()]
      .map((entry) => ({
        ...entry,
        successRate: roundSuccessRate(entry.successfulRuns, entry.count),
      }))
      .sort((left, right) => right.count - left.count || left.actionId.localeCompare(right.actionId) || left.bucket.localeCompare(right.bucket)),
    automaticActionPromotionCandidates: [...automaticActionBucketPerformance.values()]
      .map((entry) => ({
        ...entry,
        successRate: roundSuccessRate(entry.successfulRuns, entry.count),
      }))
      .filter((entry) => (
        entry.count >= AUTOMATIC_ACTION_PROMOTION_MIN_RUNS
        && entry.successRate >= AUTOMATIC_ACTION_PROMOTION_MIN_SUCCESS_RATE
        && entry.failedRuns <= AUTOMATIC_ACTION_PROMOTION_MAX_FAILED_RUNS
      ))
      .sort((left, right) => right.successRate - left.successRate || right.count - left.count || left.actionId.localeCompare(right.actionId) || left.bucket.localeCompare(right.bucket)),
  };
}

function renderBenchmarkPrSummary(insights, projectLabel, workflowHistory) {
  const lines = [
    '# Benchmark PR Summary',
    '',
    `- Project: ${projectLabel}`,
    `- Reports: ${insights.reports.length}`,
  ];

  for (const report of insights.reports) {
    lines.push(
      '',
      `## ${report.slug}`,
      '',
      `- Title: ${report.title}`,
      `- Generated: ${report.generatedAt}`,
      ...(report.summary ? [`- Summary: ${report.summary}`] : []),
      `- Samples: ${report.sampleCount}`,
    );

    if ((report.acceptances ?? []).length === 0) {
      lines.push('- Acceptance: none');
      continue;
    }

    lines.push('- Acceptance:');
    for (const acceptance of report.acceptances) {
      lines.push([
        `  - ${acceptance.label}`,
        `target ${acceptance.target}`,
        `current ${acceptance.actual}`,
        acceptance.previousActual ? `previous ${acceptance.previousActual}` : 'previous n/a',
        acceptance.pass ? 'PASS' : 'FAIL',
      ].join(' | '));
    }
  }

  if (workflowHistory && workflowHistory.totalRuns > 0) {
    lines.push(
      '',
      '## workflow-delivery',
      '',
      `- Total runs: ${workflowHistory.totalRuns}`,
      `- Success rate: ${(workflowHistory.successRate * 100).toFixed(1)}%`,
    );

    if ((workflowHistory.rollingWindows ?? []).length > 0) {
      lines.push('- Trend:');
      for (const window of workflowHistory.rollingWindows) {
        lines.push(`  - ${window.label} | runs ${window.totalRuns} | success ${(window.successRate * 100).toFixed(1)}% | ok ${window.successfulRuns} | fail ${window.failedRuns}`);
      }
    }

    if ((workflowHistory.byFlow ?? []).length > 0) {
      lines.push('- Flow success:');
      for (const flow of workflowHistory.byFlow) {
        lines.push(`  - ${flow.flow} | runs ${flow.count} | success ${(flow.successRate * 100).toFixed(1)}% | avg ${flow.avgDurationMs.toFixed(1)}ms`);
      }
    }

    if ((workflowHistory.failureBuckets ?? []).length > 0) {
      lines.push('- Failure buckets:');
      for (const bucket of workflowHistory.failureBuckets) {
        lines.push(`  - ${bucket.bucket} | count ${bucket.count}`);
      }
    }

    if ((workflowHistory.policyPerformance ?? []).length > 0) {
      lines.push('- Policy success:');
      for (const policy of workflowHistory.policyPerformance) {
        lines.push(`  - ${policy.policyId} | runs ${policy.count} | success ${(policy.successRate * 100).toFixed(1)}% | ok ${policy.successfulRuns} | fail ${policy.failedRuns}`);
      }
    }

    if ((workflowHistory.policyBucketPerformance ?? []).length > 0) {
      lines.push('- Policy x bucket:');
      for (const policyBucket of workflowHistory.policyBucketPerformance) {
        lines.push(`  - ${policyBucket.policyId} | bucket ${policyBucket.bucket} | runs ${policyBucket.count} | success ${(policyBucket.successRate * 100).toFixed(1)}% | ok ${policyBucket.successfulRuns} | fail ${policyBucket.failedRuns}`);
      }
    }

    if ((workflowHistory.automaticActionPerformance ?? []).length > 0) {
      lines.push('- Automatic action success:');
      for (const action of workflowHistory.automaticActionPerformance) {
        lines.push(`  - ${action.actionId} | runs ${action.count} | success ${(action.successRate * 100).toFixed(1)}% | ok ${action.successfulRuns} | fail ${action.failedRuns}`);
      }
    }

    if ((workflowHistory.automaticActionBucketPerformance ?? []).length > 0) {
      lines.push('- Automatic action x bucket:');
      for (const actionBucket of workflowHistory.automaticActionBucketPerformance) {
        lines.push(`  - ${actionBucket.actionId} | bucket ${actionBucket.bucket} | runs ${actionBucket.count} | success ${(actionBucket.successRate * 100).toFixed(1)}% | ok ${actionBucket.successfulRuns} | fail ${actionBucket.failedRuns}`);
      }
    }

    if ((workflowHistory.automaticActionPromotionCandidates ?? []).length > 0) {
      lines.push('- Automatic action promotion candidates:');
      for (const candidate of workflowHistory.automaticActionPromotionCandidates) {
        lines.push(`  - ${candidate.actionId} | bucket ${candidate.bucket} | runs ${candidate.count} | success ${(candidate.successRate * 100).toFixed(1)}% | ok ${candidate.successfulRuns} | fail ${candidate.failedRuns}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const insights = readProjectBenchmarkInsights(args.projectRoot);
  const workflowHistory = summarizeWorkflowHistory(args.workflowHistory, args.projectRoot);
  const markdown = renderBenchmarkPrSummary(insights, path.basename(args.projectRoot), workflowHistory);

  if (args.output) {
    const outputPath = path.resolve(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, markdown, 'utf8');
  }

  process.stdout.write(markdown);
}

main();
