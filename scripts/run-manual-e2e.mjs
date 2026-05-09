import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const provider = process.env.XQODER_E2E_PROVIDER ?? 'dashscope';
const model = process.env.XQODER_E2E_MODEL ?? 'qwen-plus';
const realLlmEnabled = process.env.XQODER_REAL_LLM_E2E === '1';
const realDeployEnabled = process.env.XQODER_REAL_DEPLOY_E2E === '1';
const apiKey = process.env.DASHSCOPE_API_KEY;
const vercelToken = process.env.VERCEL_TOKEN;
const args = new Set(process.argv.slice(2));

if (args.has('--ac01-signoff')) {
  runAc01Signoff();
  process.exit(0);
}

if (args.has('--ci-fresh-evidence')) {
  runCiFreshEvidence();
  process.exit(0);
}

if (args.has('--release-branch-freeze-evidence')) {
  runReleaseBranchFreezeEvidence();
  process.exit(0);
}

run('bun', ['run', 'e2e:smoke']);

if (!realLlmEnabled || !apiKey) {
  console.log('manual e2e: preflight only (set XQODER_REAL_LLM_E2E=1 and DASHSCOPE_API_KEY to enable real fix flow)');
  process.exit(0);
}

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-manual-e2e-home-'));
const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-manual-e2e-project-'));
const srcDir = path.join(tempProject, 'src');
fs.mkdirSync(srcDir, { recursive: true });

fs.writeFileSync(path.join(tempProject, 'package.json'), JSON.stringify({
  name: 'xqoder-manual-e2e-fixture',
  private: true,
  type: 'module',
  scripts: {
    build: 'node -c src/index.js',
  },
}, null, 2));
fs.writeFileSync(path.join(srcDir, 'index.js'), [
  "export function greet(name) {",
  "  console.log(`hello ${name}`)",
  '',
].join('\n'));

const sharedEnv = {
  ...process.env,
  HOME: tempHome,
};

run('bun', ['dist/index.js', 'config', 'init', '--provider', provider, '--model', model, '--api-key', apiKey], {
  env: sharedEnv,
});
run('bun', ['dist/index.js', 'fix', '--dir', tempProject, '--model', model, '--max-attempts', '2'], {
  env: sharedEnv,
});
run('npm', ['run', 'build'], {
  cwd: tempProject,
  env: sharedEnv,
});

if (!realDeployEnabled || !vercelToken) {
  console.log('manual e2e: deploy skipped (set XQODER_REAL_DEPLOY_E2E=1 and VERCEL_TOKEN to enable deploy flow)');
  process.exit(0);
}

run('bun', ['dist/index.js', 'deploy', '--dir', tempProject, '--token', vercelToken], {
  env: sharedEnv,
});

function runAc01Signoff() {
  const credential = resolveProviderCredential(provider);
  const artifactDir = path.join(rootDir, '.omx', 'logs', `ac01-newcomer-cold-start-${formatTimestamp(new Date())}`);
  fs.mkdirSync(artifactDir, { recursive: true });

  const result = {
    date: new Date().toISOString().slice(0, 10),
    status: 'PASS',
    provider,
    model,
    requiredRuns: 2,
    completedRuns: 0,
    artifactDirectory: artifactDir,
    runs: [],
  };

  for (let runIndex = 1; runIndex <= 2; runIndex += 1) {
    const startedAt = Date.now();
    const tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), `xqoder-ac01-home-${runIndex}-`));
    const tempWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `xqoder-ac01-workspace-${runIndex}-`));
    const projectCopy = path.join(tempWorkspaceRoot, 'XQoder');
    copyProjectForColdStart(projectCopy);
    installIsolatedCredential(tempHomeDir, provider, credential);

    const runEnv = {
      ...process.env,
      HOME: tempHomeDir,
      XDG_CONFIG_HOME: path.join(tempHomeDir, '.config'),
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    };

    const steps = [
      {
        name: 'install',
        command: 'bun install',
        file: 'bun',
        args: ['install'],
        cwd: projectCopy,
      },
      {
        name: 'build',
        command: 'bun run build',
        file: 'bun',
        args: ['run', 'build'],
        cwd: projectCopy,
      },
      {
        name: 'config_init',
        command: `bun dist/index.js config init --provider ${provider} --model ${model}`,
        file: 'bun',
        args: ['dist/index.js', 'config', 'init', '--provider', provider, '--model', model],
        cwd: projectCopy,
      },
      {
        name: 'root_help',
        command: 'bun dist/index.js --help',
        file: 'bun',
        args: ['dist/index.js', '--help'],
        cwd: projectCopy,
      },
      {
        name: 'first_task',
        command: 'bun dist/index.js chat "概述这个仓库的主要目录" --dir . --new-session --format json',
        file: 'bun',
        args: ['dist/index.js', 'chat', '概述这个仓库的主要目录', '--dir', '.', '--new-session', '--format', 'json'],
        cwd: projectCopy,
      },
    ];

    let runStatus = 'PASS';
    let chatResponseLength = 0;
    let sessionId;
    const executedSteps = [];

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const step = steps[stepIndex];
      const stepResult = executeLoggedStep({
        ...step,
        env: runEnv,
        logPath: path.join(artifactDir, `run-${runIndex}-${String(stepIndex + 1).padStart(2, '0')}-${step.name}.log`),
      });
      executedSteps.push(stepResult);
      if (!stepResult.ok) {
        runStatus = 'FAIL';
        break;
      }

      if (step.name === 'first_task') {
        const envelope = extractTrailingJsonObject(stepResult.stdout);
        if (!envelope || typeof envelope.response !== 'string' || envelope.response.trim().length === 0) {
          runStatus = 'FAIL';
          break;
        }
        chatResponseLength = envelope.response.trim().length;
        sessionId = typeof envelope.sessionId === 'string' ? envelope.sessionId : undefined;
        fs.writeFileSync(
          path.join(artifactDir, `run-${runIndex}-first-task-response.json`),
          `${JSON.stringify(envelope, null, 2)}\n`,
          'utf8',
        );
      }
    }

    const totalDurationMs = Date.now() - startedAt;
    const withinTenMinutes = totalDurationMs <= 10 * 60 * 1000;
    if (!withinTenMinutes) {
      runStatus = 'FAIL';
    }

    result.runs.push({
      id: `run-${runIndex}`,
      status: runStatus,
      workspace: projectCopy,
      home: tempHomeDir,
      totalDurationMs,
      withinTenMinutes,
      chatResponseLength,
      ...(sessionId ? { sessionId } : {}),
      steps: executedSteps,
    });
    if (runStatus !== 'PASS') {
      result.status = 'FAIL';
    }
  }

  result.completedRuns = result.runs.filter((run) => run.status === 'PASS').length;
  if (result.completedRuns !== result.requiredRuns) {
    result.status = 'FAIL';
  }

  fs.writeFileSync(path.join(artifactDir, 'ac01-newcomer-cold-start-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.join(rootDir, 'docs', 'release'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'docs', 'release', 'ac01-newcomer-cold-start-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'PASS') {
    process.exitCode = 1;
  }
}

function runCiFreshEvidence() {
  const artifactDir = path.join(rootDir, '.omx', 'logs', `ci-fresh-evidence-${formatTimestamp(new Date())}`);
  fs.mkdirSync(artifactDir, { recursive: true });

  const result = {
    date: new Date().toISOString().slice(0, 10),
    status: 'PASS',
    artifactDirectory: artifactDir,
    metricsPath: path.join(rootDir, 'docs', 'release', 'latest-acceptance-metrics.json'),
    steps: [],
  };

  const runEnv = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };

  const steps = [
    {
      name: 'install',
      command: 'bun install --frozen-lockfile',
      file: 'bun',
      args: ['install', '--frozen-lockfile'],
      cwd: rootDir,
    },
    {
      name: 'release_check',
      command: 'bun run release:check',
      file: 'bun',
      args: ['run', 'release:check'],
      cwd: rootDir,
    },
    {
      name: 'acceptance_metrics',
      command: 'bun run acceptance:metrics',
      file: 'bun',
      args: ['run', 'acceptance:metrics'],
      cwd: rootDir,
    },
  ];

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex];
    const stepResult = executeLoggedStep({
      ...step,
      env: runEnv,
      logPath: path.join(artifactDir, `${String(stepIndex + 1).padStart(2, '0')}-${step.name}.log`),
    });
    result.steps.push(stepResult);
    if (!stepResult.ok) {
      result.status = 'FAIL';
      break;
    }
  }

  const metricsValidation = validateAcceptanceMetrics(result.metricsPath);
  result.metricsValidation = metricsValidation;
  if (!metricsValidation.ok) {
    result.status = 'FAIL';
  }

  fs.mkdirSync(path.join(rootDir, 'docs', 'release'), { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'ci-fresh-evidence-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(rootDir, 'docs', 'release', 'ci-fresh-evidence-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(rootDir, 'docs', 'release', 'ci-fresh-evidence-signoff.md'), renderCiFreshEvidenceSignoff(result), 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'PASS') {
    process.exitCode = 1;
  }
}

function runReleaseBranchFreezeEvidence() {
  const artifactDir = path.join(rootDir, '.omx', 'logs', `release-branch-freeze-evidence-${formatTimestamp(new Date())}`);
  fs.mkdirSync(artifactDir, { recursive: true });

  const commands = [
    { name: 'git_status', args: ['status', '--short', '--branch'] },
    { name: 'git_branch_current', args: ['branch', '--show-current'] },
    { name: 'git_branch_all', args: ['branch', '--all'] },
    { name: 'git_tags', args: ['tag'] },
    { name: 'git_log_recent', args: ['log', '--decorate', '--oneline', '-n', '40'] },
  ];

  const steps = commands.map((command, index) => executeLoggedStep({
    name: command.name,
    command: `git ${command.args.join(' ')}`,
    file: 'git',
    args: ['-C', rootDir, ...command.args],
    cwd: rootDir,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    logPath: path.join(artifactDir, `${String(index + 1).padStart(2, '0')}-${command.name}.log`),
  }));

  const currentBranch = steps.find((step) => step.name === 'git_branch_current')?.stdout.trim() ?? '';
  const allBranches = splitNonEmptyLines(steps.find((step) => step.name === 'git_branch_all')?.stdout ?? '');
  const tags = splitNonEmptyLines(steps.find((step) => step.name === 'git_tags')?.stdout ?? '');
  const recentCommits = splitNonEmptyLines(steps.find((step) => step.name === 'git_log_recent')?.stdout ?? '');
  const releaseBranchMatches = allBranches.filter((branch) => /release\//i.test(branch));
  const freezeMentions = recentCommits.filter((line) => /freeze|release|closeout|signoff|rc\b/i.test(line));
  const hasDirectReleaseBranchEvidence = releaseBranchMatches.length > 0;

  const stepStatus = steps.every((step) => step.ok) ? 'PASS' : 'FAIL';
  const evidenceStatus = hasDirectReleaseBranchEvidence ? 'PASS' : 'PARTIAL';
  const result = {
    date: new Date().toISOString().slice(0, 10),
    status: stepStatus,
    evidenceStatus,
    artifactDirectory: artifactDir,
    currentBranch,
    releaseBranchMatches,
    tags,
    freezeMentions,
    hasDirectReleaseBranchEvidence,
    note: hasDirectReleaseBranchEvidence
      ? 'Direct release branch evidence found in git refs.'
      : 'No release/* branch was found in current git refs; freeze evidence remains indirect unless supplemented externally.',
    steps,
  };

  fs.mkdirSync(path.join(rootDir, 'docs', 'release'), { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'release-branch-freeze-evidence.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(rootDir, 'docs', 'release', 'release-branch-freeze-evidence.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(rootDir, 'docs', 'release', 'release-branch-freeze-evidence.md'), renderReleaseBranchFreezeEvidence(result), 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'PASS') {
    process.exitCode = 1;
  }
}

function copyProjectForColdStart(destination) {
  fs.cpSync(rootDir, destination, {
    recursive: true,
    filter: (source) => {
      const relativePath = path.relative(rootDir, source);
      if (!relativePath) {
        return true;
      }
      const topLevel = relativePath.split(path.sep)[0];
      return !new Set(['node_modules', 'dist', 'coverage', '.omx', '.git']).has(topLevel);
    },
  });
}

function renderReleaseBranchFreezeEvidence(result) {
  const stepRows = result.steps.map((step) => `| ${step.command} | ${step.exitCode} | ${step.logPath} |`).join('\n');
  const releaseRows = result.releaseBranchMatches.length > 0 ? result.releaseBranchMatches.map((line) => `- ${line}`).join('\n') : '- none';
  const freezeRows = result.freezeMentions.length > 0 ? result.freezeMentions.map((line) => `- ${line}`).join('\n') : '- none';
  const tagRows = result.tags.length > 0 ? result.tags.map((line) => `- ${line}`).join('\n') : '- none';
  return [
    '# Release Branch / Freeze Evidence',
    '',
    `Date: ${result.date}`,
    '',
    '## Summary',
    '',
    `- Command status: ${result.status}`,
    `- Evidence status: ${result.evidenceStatus}`,
    `- Current branch: ${result.currentBranch || 'unknown'}`,
    `- Direct release branch evidence: ${result.hasDirectReleaseBranchEvidence ? 'Yes' : 'No'}`,
    `- Note: ${result.note}`,
    '',
    '## Matching release branches',
    '',
    releaseRows,
    '',
    '## Release / freeze related recent commits',
    '',
    freezeRows,
    '',
    '## Tags',
    '',
    tagRows,
    '',
    '## Commands',
    '',
    '| Command | Exit | Log |',
    '| --- | --- | --- |',
    stepRows || '| n/a | n/a | n/a |',
    '',
  ].join('\n');
}

function splitNonEmptyLines(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function validateAcceptanceMetrics(metricsPath) {
  if (!fs.existsSync(metricsPath)) {
    return {
      ok: false,
      reason: `Missing metrics file: ${metricsPath}`,
    };
  }

  const parsed = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
  const metrics = parsed?.acceptanceMetrics;
  const requiredFields = [
    'success_rate',
    'avg_steps',
    'tool_failure_rate',
    'approval_interruption_rate',
    'rollback_rate',
  ];
  const missingFields = requiredFields.filter((field) => typeof metrics?.[field] !== 'number');
  return {
    ok: missingFields.length === 0,
    dryRun: parsed?.summary?.dryRun === true,
    missingFields,
    acceptanceMetrics: metrics ?? null,
    summary: parsed?.summary ?? null,
    taskIds: Array.isArray(parsed?.taskIds) ? parsed.taskIds : [],
    reason: missingFields.length === 0 ? 'acceptanceMetrics present' : `Missing numeric acceptance fields: ${missingFields.join(', ')}`,
  };
}

function renderCiFreshEvidenceSignoff(result) {
  const stepRows = result.steps.map((step) => `| ${step.command} | ${step.exitCode} | ${step.durationMs} | ${step.logPath} |`).join('\n');
  const validation = result.metricsValidation ?? { ok: false, reason: 'validation missing', missingFields: [] };
  const acceptanceMetrics = validation.acceptanceMetrics ?? {};
  const summary = validation.summary ?? {};
  return [
    '# CI Fresh Evidence Signoff',
    '',
    `Date: ${result.date}`,
    '',
    '## Scope',
    '',
    'This signoff re-runs the current repository closeout chain used by CI evidence collection:',
    '',
    '1. `bun install --frozen-lockfile`',
    '2. `bun run release:check`',
    '3. `bun run acceptance:metrics`',
    '4. validate `docs/release/latest-acceptance-metrics.json`',
    '',
    '## Artifact directory',
    '',
    `- \`${result.artifactDirectory}\``,
    '',
    '## Step results',
    '',
    '| Command | Exit | Duration (ms) | Log |',
    '| --- | --- | --- | --- |',
    stepRows || '| n/a | n/a | n/a | n/a |',
    '',
    '## Acceptance metrics validation',
    '',
    `- Validation status: ${validation.ok ? 'PASS' : 'FAIL'}`,
    `- Validation note: ${validation.reason}`,
    `- Dry run export: ${summary.dryRun === true ? 'Yes' : 'No'}`,
    `- success_rate: ${acceptanceMetrics.success_rate ?? 'n/a'}`,
    `- avg_steps: ${acceptanceMetrics.avg_steps ?? 'n/a'}`,
    `- tool_failure_rate: ${acceptanceMetrics.tool_failure_rate ?? 'n/a'}`,
    `- approval_interruption_rate: ${acceptanceMetrics.approval_interruption_rate ?? 'n/a'}`,
    `- rollback_rate: ${acceptanceMetrics.rollback_rate ?? 'n/a'}`,
    '',
    '## Conclusion',
    '',
    result.status === 'PASS'
      ? 'The repository now has a fresh in-repo closeout run showing the release check chain passes and the acceptance metrics export is regenerated and validated.'
      : 'The fresh closeout run did not fully pass. See the artifact logs and JSON result for the failing step or validation gap.',
    '',
  ].join('\n');
}

function installIsolatedCredential(homeDir, providerName, credential) {
  const credentialDir = path.join(homeDir, '.xqoder', 'credentials');
  fs.mkdirSync(credentialDir, { recursive: true });
  fs.writeFileSync(path.join(credentialDir, `${providerName}.key`), `${credential}\n`, 'utf8');
}

function resolveProviderCredential(providerName) {
  const explicit = process.env.XQODER_E2E_API_KEY?.trim();
  if (explicit) {
    return explicit;
  }

  const providerEnvMap = {
    anthropic: 'ANTHROPIC_API_KEY',
    dashscope: 'DASHSCOPE_API_KEY',
    gemini: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  const providerEnvKey = providerEnvMap[providerName];
  if (providerEnvKey) {
    const fromEnv = process.env[providerEnvKey]?.trim();
    if (fromEnv) {
      return fromEnv;
    }
  }

  const credentialPath = path.join(os.homedir(), '.xqoder', 'credentials', `${providerName}.key`);
  if (fs.existsSync(credentialPath)) {
    const fromFile = fs.readFileSync(credentialPath, 'utf8').trim();
    if (fromFile) {
      return fromFile;
    }
  }

  const configPath = path.join(os.homedir(), '.xqoder', 'config.json');
  if (fs.existsSync(configPath)) {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const fromConfig = parsed?.providers?.[providerName]?.apiKey?.trim();
    if (fromConfig) {
      return fromConfig;
    }
  }

  throw new Error(`AC-01 signoff requires a credential for provider ${providerName}. Set XQODER_E2E_API_KEY, ${providerEnvKey ?? 'a provider env key'}, or ~/.xqoder/credentials/${providerName}.key.`);
}

function executeLoggedStep(step) {
  const startedAt = Date.now();
  const result = spawnSync(step.file, step.args, {
    cwd: step.cwd,
    env: step.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  const exitCode = result.status ?? (result.error ? 1 : 0);
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  fs.writeFileSync(step.logPath, [
    `$ ${step.command}`,
    `cwd: ${step.cwd}`,
    `exitCode: ${exitCode}`,
    `durationMs: ${durationMs}`,
    '',
    '--- stdout ---',
    stdout,
    '',
    '--- stderr ---',
    stderr,
    '',
  ].join('\n'), 'utf8');
  return {
    name: step.name,
    command: step.command,
    cwd: step.cwd,
    logPath: step.logPath,
    durationMs,
    exitCode,
    ok: exitCode === 0,
    stdout,
    stderr,
  };
}

function extractTrailingJsonObject(rawOutput) {
  const sanitized = stripAnsi(rawOutput)
    .replace(/\r[^\n]*/g, '')
    .trim();
  const jsonStart = sanitized.lastIndexOf('\n{');
  const candidate = (jsonStart >= 0 ? sanitized.slice(jsonStart + 1) : sanitized).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function stripAnsi(value) {
  return value.replace(/\[[0-9;]*[A-Za-z]/g, '');
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
}
