import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

export function expandEnvTemplate(input, env = process.env) {
  return String(input ?? '').replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => env[name] ?? '');
}

function resolveConfiguredPath(input, manifestDir, env = process.env) {
  const expanded = expandEnvTemplate(input, env).trim();
  if (expanded.length === 0) {
    return null;
  }
  return path.resolve(manifestDir, expanded);
}

function normalizeProjectPath(input, sourceLabel) {
  const value = String(input ?? '').trim();
  if (value.length === 0) {
    return '.';
  }
  if (path.isAbsolute(value)) {
    throw new Error(`${sourceLabel}: projectPath must be relative`);
  }

  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${sourceLabel}: projectPath must stay within checkoutRoot`);
  }

  return normalized === '' ? '.' : normalized;
}

function isInsideDirectory(parentDir, candidatePath) {
  const relative = path.relative(parentDir, candidatePath);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeScenarios(input, sourceLabel) {
  if (input === undefined) {
    return undefined;
  }
  if (!Array.isArray(input)) {
    throw new Error(`${sourceLabel}: scenarios must be an array`);
  }

  const scenarios = [...new Set(
    input
      .map((value) => String(value ?? '').trim())
      .filter((value) => value === 'test' || value === 'fix' || value === 'build' || value === 'deploy'),
  )];

  if (scenarios.length === 0) {
    throw new Error(`${sourceLabel}: scenarios must contain at least one supported value`);
  }

  return scenarios;
}

function normalizeStringArray(input, sourceLabel, fieldName) {
  if (input === undefined) {
    return undefined;
  }
  if (!Array.isArray(input)) {
    throw new Error(`${sourceLabel}: ${fieldName} must be an array`);
  }

  const values = [...new Set(
    input
      .map((value) => String(value ?? '').trim())
      .filter((value) => value.length > 0),
  )];

  if (values.length === 0) {
    throw new Error(`${sourceLabel}: ${fieldName} must contain at least one non-empty value`);
  }

  return values;
}

function normalizeRequiredPaths(input, sourceLabel, projectRoot, env = process.env) {
  const values = normalizeStringArray(input, sourceLabel, 'requiredPaths');
  if (!values) {
    return undefined;
  }

  return values.map((value) => {
    const expanded = expandEnvTemplate(value, env).trim();
    if (expanded.length === 0) {
      throw new Error(`${sourceLabel}: requiredPaths must not contain empty values`);
    }
    return path.resolve(projectRoot, expanded);
  });
}

function normalizeReadinessChecks(input, sourceLabel) {
  if (input === undefined) {
    return undefined;
  }
  if (!Array.isArray(input)) {
    throw new Error(`${sourceLabel}: readinessChecks must be an array`);
  }

  const checks = input.map((entry, index) => {
    const label = String(entry?.label ?? '').trim();
    const command = String(entry?.command ?? '').trim();
    if (label.length === 0 || command.length === 0) {
      throw new Error(`${sourceLabel}: readinessChecks[${index}] must include label and command`);
    }
    return { label, command };
  });

  if (checks.length === 0) {
    throw new Error(`${sourceLabel}: readinessChecks must contain at least one item`);
  }

  return checks;
}

function normalizeStringRecord(input, sourceLabel, fieldName, env = process.env) {
  if (input === undefined) {
    return undefined;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${sourceLabel}: ${fieldName} must be an object`);
  }

  const entries = Object.entries(input)
    .map(([key, value]) => [String(key).trim(), expandEnvTemplate(value, env).trim()])
    .filter(([key, value]) => key.length > 0 && value.length > 0);

  if (entries.length === 0) {
    throw new Error(`${sourceLabel}: ${fieldName} must contain at least one non-empty entry`);
  }

  return Object.fromEntries(entries);
}

function getShellCommand() {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c'],
    };
  }

  return {
    command: '/bin/sh',
    args: ['-c'],
  };
}

function getExecutableCandidates(command, env = process.env) {
  if (process.platform !== 'win32') {
    return [command];
  }

  const pathExt = String(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (path.extname(command).length > 0) {
    return [command];
  }

  return pathExt.map((extension) => `${command}${extension}`);
}

export function commandExists(command, env = process.env) {
  const value = String(command ?? '').trim();
  if (value.length === 0) {
    return false;
  }

  const searchPath = String(env.PATH ?? '');
  if (searchPath.length === 0) {
    return false;
  }

  const candidates = getExecutableCandidates(value, env);
  for (const segment of searchPath.split(path.delimiter).filter((entry) => entry.length > 0)) {
    for (const candidateName of candidates) {
      const candidatePath = path.join(segment, candidateName);
      try {
        fs.accessSync(candidatePath, fs.constants.X_OK);
        return true;
      } catch {
        // continue
      }
    }
  }

  return false;
}

export function normalizeRealProjectTarget(project, { manifestDir, index = 0, env = process.env } = {}) {
  const sourceLabel = `projects[${index}]`;
  if (!project || typeof project !== 'object') {
    throw new Error(`${sourceLabel}: project entry must be an object`);
  }

  const configuredProjectRoot = typeof project.projectRoot === 'string' && project.projectRoot.trim().length > 0
    ? resolveConfiguredPath(project.projectRoot, manifestDir, env)
    : null;
  const configuredCheckoutRoot = typeof project.checkoutRoot === 'string' && project.checkoutRoot.trim().length > 0
    ? resolveConfiguredPath(project.checkoutRoot, manifestDir, env)
    : null;

  if (!configuredProjectRoot && !configuredCheckoutRoot) {
    throw new Error(`${sourceLabel}: projectRoot or checkoutRoot is required`);
  }

  const normalizedProjectPath = configuredCheckoutRoot
    ? normalizeProjectPath(project.projectPath ?? '.', sourceLabel)
    : undefined;
  const derivedProjectRoot = configuredCheckoutRoot
    ? path.resolve(configuredCheckoutRoot, normalizedProjectPath ?? '.')
    : null;

  if (configuredProjectRoot && configuredCheckoutRoot && !isInsideDirectory(configuredCheckoutRoot, configuredProjectRoot)) {
    throw new Error(`${sourceLabel}: projectRoot must be inside checkoutRoot`);
  }

  if (configuredProjectRoot && derivedProjectRoot && path.resolve(configuredProjectRoot) !== path.resolve(derivedProjectRoot)) {
    throw new Error(`${sourceLabel}: projectRoot does not match checkoutRoot + projectPath`);
  }

  const projectRoot = configuredProjectRoot ?? derivedProjectRoot;
  if (!projectRoot) {
    throw new Error(`${sourceLabel}: unable to resolve projectRoot`);
  }

  const checkoutRoot = configuredCheckoutRoot
    ?? (normalizedProjectPath === undefined ? undefined : projectRoot);
  const projectPath = configuredCheckoutRoot
    ? normalizedProjectPath ?? '.'
    : '.';

  const scenarios = normalizeScenarios(project.scenarios, sourceLabel);
  const requiredCommands = normalizeStringArray(project.requiredCommands, sourceLabel, 'requiredCommands');
  const requiredEnv = normalizeStringArray(project.requiredEnv, sourceLabel, 'requiredEnv');
  const requiredPaths = normalizeRequiredPaths(project.requiredPaths, sourceLabel, projectRoot, env);
  const readinessChecks = normalizeReadinessChecks(project.readinessChecks, sourceLabel);
  const commandEnv = normalizeStringRecord(project.commandEnv, sourceLabel, 'commandEnv', env);
  const deployBuildCommand = typeof project.deployBuildCommand === 'string' && project.deployBuildCommand.trim().length > 0
    ? project.deployBuildCommand.trim()
    : undefined;
  const deployOutputDir = typeof project.deployOutputDir === 'string' && project.deployOutputDir.trim().length > 0
    ? project.deployOutputDir.trim()
    : undefined;

  return {
    id: typeof project.id === 'string' && project.id.trim().length > 0
      ? project.id.trim()
      : path.basename(projectRoot),
    label: typeof project.label === 'string' && project.label.trim().length > 0
      ? project.label.trim()
      : path.basename(projectRoot),
    projectRoot: path.resolve(projectRoot),
    ...(checkoutRoot ? { checkoutRoot: path.resolve(checkoutRoot) } : {}),
    ...(projectPath ? { projectPath } : {}),
    enabled: project.enabled !== false,
    ...(scenarios ? { scenarios } : {}),
    ...(requiredCommands ? { requiredCommands } : {}),
    ...(requiredEnv ? { requiredEnv } : {}),
    ...(requiredPaths ? { requiredPaths } : {}),
    ...(readinessChecks ? { readinessChecks } : {}),
    ...(commandEnv ? { commandEnv } : {}),
    ...(deployBuildCommand ? { deployBuildCommand } : {}),
    ...(deployOutputDir ? { deployOutputDir } : {}),
    prepareCommand: typeof project.prepareCommand === 'string' && project.prepareCommand.trim().length > 0
      ? project.prepareCommand.trim()
      : undefined,
    testCommand: typeof project.testCommand === 'string' && project.testCommand.trim().length > 0
      ? project.testCommand.trim()
      : undefined,
    repo: typeof project.repo === 'string' && project.repo.trim().length > 0
      ? project.repo.trim()
      : undefined,
    ref: typeof project.ref === 'string' && project.ref.trim().length > 0
      ? project.ref.trim()
      : undefined,
    notes: typeof project.notes === 'string' && project.notes.trim().length > 0
      ? project.notes.trim()
      : undefined,
  };
}

export function evaluateRealProjectTargetReadiness(target, options = {}) {
  const env = {
    ...process.env,
    ...(target.commandEnv ?? {}),
    ...(options.env ?? {}),
  };
  const readinessTimeoutMs = Number.isFinite(options.readinessTimeoutMs) && options.readinessTimeoutMs > 0
    ? Math.floor(options.readinessTimeoutMs)
    : 3000;
  const checkoutExists = target.checkoutRoot
    ? fs.existsSync(target.checkoutRoot)
    : fs.existsSync(target.projectRoot);
  const projectExists = fs.existsSync(target.projectRoot);
  const missingCommands = (target.requiredCommands ?? []).filter((command) => !commandExists(command, env));
  const missingEnv = (target.requiredEnv ?? []).filter((name) => String(env[name] ?? '').trim().length === 0);
  const missingPaths = (target.requiredPaths ?? []).filter((candidatePath) => !fs.existsSync(candidatePath));
  const failedChecks = [];
  const blockers = [];

  if (target.repo && !checkoutExists) {
    blockers.push(`missing checkoutRoot: ${target.checkoutRoot ?? target.projectRoot}`);
  } else if (!projectExists) {
    blockers.push(`missing projectRoot: ${target.projectRoot}`);
  }

  if (missingCommands.length > 0) {
    blockers.push(`missing commands: ${missingCommands.join(', ')}`);
  }
  if (missingEnv.length > 0) {
    blockers.push(`missing env: ${missingEnv.join(', ')}`);
  }
  if (missingPaths.length > 0) {
    blockers.push(`missing paths: ${missingPaths.join(', ')}`);
  }

  if (projectExists) {
    const shell = getShellCommand();
    for (const check of target.readinessChecks ?? []) {
      try {
        execFileSync(shell.command, [...shell.args, check.command], {
          cwd: target.projectRoot,
          stdio: 'pipe',
          env,
          timeout: readinessTimeoutMs,
        });
      } catch {
        failedChecks.push(check.label);
      }
    }
  }

  if (failedChecks.length > 0) {
    blockers.push(`failed readiness checks: ${failedChecks.join(', ')}`);
  }

  const readiness = target.repo && !checkoutExists
    ? 'sync-needed'
    : blockers.length === 0
      ? 'ready'
      : 'blocked';

  return {
    readiness,
    enabled: target.enabled !== false,
    checkoutExists,
    projectExists,
    missingCommands,
    missingEnv,
    missingPaths,
    failedChecks,
    blockers,
  };
}

export function readRealProjectTargets(filePath, options = {}) {
  const resolvedFilePath = path.resolve(filePath);
  if (!fs.existsSync(resolvedFilePath)) {
    if (options.allowMissing) {
      return [];
    }
    throw new Error(`targets file not found: ${resolvedFilePath}`);
  }

  const manifestDir = path.dirname(resolvedFilePath);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedFilePath, 'utf8'));
  } catch (error) {
    throw new Error(`failed to parse targets file ${resolvedFilePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const projects = Array.isArray(parsed?.projects) ? parsed.projects : [];
  const targets = projects.map((project, index) => normalizeRealProjectTarget(project, {
    manifestDir,
    index,
    env: options.env ?? process.env,
  }));

  if (targets.length === 0 && !options.allowEmpty) {
    throw new Error(`no valid targets found in ${resolvedFilePath}`);
  }

  return targets;
}
