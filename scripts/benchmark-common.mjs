import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeQualityOverviewReports } from './quality-report-common.mjs';

export const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const benchmarksDir = path.join(repoRoot, 'docs', 'benchmarks');

export function appendReportHistory(baseDir, slug, report) {
  const historyDir = path.join(baseDir, 'history');
  const historyPath = path.join(historyDir, `${slug}.jsonl`);
  fs.mkdirSync(historyDir, { recursive: true });

  const lines = fs.existsSync(historyPath)
    ? fs.readFileSync(historyPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    : [];
  const lastLine = lines[lines.length - 1];
  if (lastLine) {
    try {
      const lastReport = JSON.parse(lastLine);
      if (lastReport?.generatedAt === report.generatedAt) {
        return { historyPath, appended: false };
      }
    } catch {
      // Ignore malformed history entries and continue appending a fresh snapshot.
    }
  }

  fs.appendFileSync(historyPath, `${JSON.stringify(report)}\n`, 'utf8');
  return { historyPath, appended: true };
}

export function computeStats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = samples.reduce((acc, value) => acc + value, 0) / samples.length;
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg,
    p50: pick(0.5),
    p95: pick(0.95),
  };
}

export function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

export function formatMetric(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? `${value}` : `${value.toFixed(3)}`;
  }
  if (typeof value === 'boolean') {
    return value ? 'PASS' : 'FAIL';
  }
  return String(value);
}

function buildMarkdown(report) {
  const lines = [
    `# ${report.title}`,
    '',
    `- Generated: ${report.generatedAt}`,
  ];

  if (report.summary) {
    lines.push(`- Summary: ${report.summary}`);
  }

  if (report.meta && Object.keys(report.meta).length > 0) {
    lines.push('', '## Meta', '', '| Key | Value |', '| --- | --- |');
    for (const [key, value] of Object.entries(report.meta)) {
      lines.push(`| ${key} | ${formatMetric(value)} |`);
    }
  }

  for (const section of report.sections ?? []) {
    lines.push('', `## ${section.title}`, '', '| Metric | Value |', '| --- | ---: |');
    for (const [key, value] of Object.entries(section.metrics)) {
      lines.push(`| ${key} | ${formatMetric(value)} |`);
    }
  }

  if ((report.acceptance ?? []).length > 0) {
    lines.push('', '## Acceptance', '', '| Check | Target | Actual | Result |', '| --- | --- | --- | --- |');
    for (const item of report.acceptance) {
      lines.push(`| ${item.label} | ${item.target} | ${item.actual} | ${item.pass ? 'PASS' : 'FAIL'} |`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function writeBenchmarkReport(slug, report) {
  fs.mkdirSync(benchmarksDir, { recursive: true });
  const jsonPath = path.join(benchmarksDir, `${slug}.json`);
  const markdownPath = path.join(benchmarksDir, `${slug}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, buildMarkdown(report), 'utf8');
  const { historyPath } = appendReportHistory(benchmarksDir, slug, report);
  writeQualityOverviewReports({ projectRoot: repoRoot });
  return { jsonPath, markdownPath, historyPath };
}

export function ensureBuiltFiles(paths) {
  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`required build artifact not found: ${filePath}`);
    }
  }
}
