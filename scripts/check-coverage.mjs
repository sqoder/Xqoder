import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(import.meta.dirname, '..');
const coverageDir = path.join(rootDir, 'coverage');
const coverageFile = path.join(coverageDir, 'lcov.info');
const bunExecutable = process.platform === 'win32' ? 'bun.exe' : 'bun';

const COVERAGE_RULES = {
  // Transitional repo-wide floor. Ratchet upward incrementally:
  // 36% landed in this pass, with 45% / 50% as the next milestones once
  // more legacy-heavy execution paths are covered.
  overallLineMin: 36,
  criticalFiles: [
    { path: 'src/domain/permissions/approval.ts', lineMin: 90 },
    { path: 'src/domain/permissions/tool-policy.ts', lineMin: 90 },
    { path: 'src/infra/shared/config.ts', lineMin: 65 },
    { path: 'src/infra/shared/config-normalizers.ts', lineMin: 65 },
    { path: 'src/interfaces/http/server-openapi.ts', lineMin: 90 },
    { path: 'src/interfaces/http/server-openapi-components.ts', lineMin: 90 },
    { path: 'src/interfaces/http/server-openapi-paths.ts', lineMin: 90 },
    { path: 'src/application/chat/run-chat.ts', lineMin: 90 },
    { path: 'src/application/config/doctor.ts', lineMin: 70 },
    { path: 'src/application/config/service.ts', lineMin: 60 },
    { path: 'src/application/sessions/session-resolve.ts', lineMin: 80 },
    { path: 'src/cli/root-shell.ts', lineMin: 60 },
    { path: 'src/commands/core/agent.ts', lineMin: 75 },
    { path: 'src/commands/core/auth.ts', lineMin: 85 },
    { path: 'src/commands/core/models.ts', lineMin: 85 },
    { path: 'src/commands/sessions/stats.ts', lineMin: 75 },
    { path: 'src/core/agent/mcp-inspection.ts', lineMin: 85 },
    { path: 'src/core/agent/mcp-tools.ts', lineMin: 80 },
    { path: 'src/infrastructure/agent/tui-agent-service.ts', lineMin: 80 },
    { path: 'src/interfaces/tui/index.ts', lineMin: 50 },
    { path: 'src/platform/terminal/app/agent-runtime.ts', lineMin: 70 },
    // The terminal scrollback shell still needs deeper scenario coverage, but
    // keep raising the floor so regressions fail before the next pass.
    { path: 'src/platform/terminal/app/run-terminal-app.ts', lineMin: 50 },
  ],
};

function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}

function computePercent(covered, total) {
  if (total <= 0) {
    return 100;
  }

  return (covered / total) * 100;
}

function normalizeRelativePath(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

function runCoverage() {
  fs.rmSync(coverageDir, { recursive: true, force: true });

  // Match the `test` script in package.json: only XQoder's own sources are
  // in scope. Without an explicit path list, Bun walks the repo root and
  // picks up `openclaude/**` (a reference-only clone, see .gitignore), which
  // contributes 300+ unrelated test files and breaks coverage.
  const result = spawnSync(
    bunExecutable,
    ['test', './test', './src', '--coverage', '--coverage-reporter=lcov'],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function parseLcov() {
  if (!fs.existsSync(coverageFile)) {
    throw new Error(`coverage file not found: ${coverageFile}`);
  }

  const records = new Map();
  const lines = fs.readFileSync(coverageFile, 'utf-8').split('\n');

  let currentFile = null;
  let currentRecord = null;

  const flushCurrentRecord = () => {
    if (!currentFile || !currentRecord) {
      return;
    }

    records.set(currentFile, {
      linesFound: currentRecord.linesFound,
      linesHit: currentRecord.linesHit,
      lineCoverage: computePercent(currentRecord.linesHit, currentRecord.linesFound),
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith('SF:')) {
      flushCurrentRecord();
      currentFile = normalizeRelativePath(line.slice(3));
      currentRecord = {
        linesFound: 0,
        linesHit: 0,
      };
      continue;
    }

    if (!currentRecord) {
      continue;
    }

    if (line.startsWith('LF:')) {
      currentRecord.linesFound = Number.parseInt(line.slice(3), 10) || 0;
      continue;
    }

    if (line.startsWith('LH:')) {
      currentRecord.linesHit = Number.parseInt(line.slice(3), 10) || 0;
      continue;
    }

    if (line === 'end_of_record') {
      flushCurrentRecord();
      currentFile = null;
      currentRecord = null;
    }
  }

  flushCurrentRecord();
  return records;
}

function evaluateCoverage(records) {
  let totalLinesFound = 0;
  let totalLinesHit = 0;

  for (const record of records.values()) {
    totalLinesFound += record.linesFound;
    totalLinesHit += record.linesHit;
  }

  const overallLineCoverage = computePercent(totalLinesHit, totalLinesFound);
  const failures = [];

  if (overallLineCoverage < COVERAGE_RULES.overallLineMin) {
    failures.push(
      `overall line coverage ${formatPercent(overallLineCoverage)} is below ${formatPercent(COVERAGE_RULES.overallLineMin)}`,
    );
  }

  for (const rule of COVERAGE_RULES.criticalFiles) {
    const record = records.get(rule.path);
    if (!record) {
      failures.push(`missing coverage record for ${rule.path}`);
      continue;
    }

    if (record.lineCoverage < rule.lineMin) {
      failures.push(
        `${rule.path} line coverage ${formatPercent(record.lineCoverage)} is below ${formatPercent(rule.lineMin)}`,
      );
    }
  }

  return {
    overallLineCoverage,
    totalLinesHit,
    totalLinesFound,
    failures,
  };
}

function printSummary(records, evaluation) {
  console.log('\nCOVERAGE GATE REPORT');
  console.log('====================');
  console.log(
    `Overall line coverage: ${formatPercent(evaluation.overallLineCoverage)} (${evaluation.totalLinesHit}/${evaluation.totalLinesFound})`,
  );
  console.log(`Required overall minimum: ${formatPercent(COVERAGE_RULES.overallLineMin)}`);
  console.log('');
  console.log('Critical file thresholds:');

  for (const rule of COVERAGE_RULES.criticalFiles) {
    const record = records.get(rule.path);
    const actual = record ? formatPercent(record.lineCoverage) : 'missing';
    console.log(`- ${rule.path}: ${actual} (min ${formatPercent(rule.lineMin)})`);
  }

  if (evaluation.failures.length === 0) {
    console.log('\nCoverage gate: PASS');
    return;
  }

  console.error('\nCoverage gate: FAIL');
  for (const failure of evaluation.failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

runCoverage();
const records = parseLcov();
const evaluation = evaluateCoverage(records);
printSummary(records, evaluation);
