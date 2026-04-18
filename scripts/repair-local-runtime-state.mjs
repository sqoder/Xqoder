import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const stateDir = path.join(rootDir, '.omx', 'state');
const stateFiles = [
  'session.json',
  'current-task-baseline.json',
  'notify-fallback-state.json',
  'notify-fallback-authority-owner.json',
  'dispatch.json',
];
const checkOnly = process.argv.includes('--check');

function collectKnownRoots() {
  const candidates = new Set();
  const errors = [];
  const seedFiles = [
    { file: 'session.json', fieldPaths: [['cwd']] },
    { file: 'current-task-baseline.json', fieldPaths: [['tasks', '*', 'worktree_path']] },
    {
      file: 'notify-fallback-state.json',
      fieldPaths: [
        ['ralph_continue_steer', 'shared_timestamp_path'],
        ['ralph_continue_steer', 'singleton_lock_path'],
      ],
    },
  ];

  for (const seed of seedFiles) {
    const absolutePath = path.join(stateDir, seed.file);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    try {
      const json = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
      for (const fieldPath of seed.fieldPaths) {
        collectRootsAtPath(json, fieldPath, candidates);
      }
    } catch (error) {
      errors.push({
        file: path.relative(rootDir, absolutePath).replace(/\\/g, '/'),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  candidates.delete(rootDir);
  return {
    roots: [...candidates],
    errors,
  };
}

function collectRootsAtPath(value, fieldPath, candidates) {
  if (fieldPath.length === 0) {
    if (typeof value !== 'string' || !value) {
      return;
    }

    const normalized = extractRootCandidate(value);
    if (normalized) {
      candidates.add(normalized);
    }
    return;
  }

  const [head, ...tail] = fieldPath;
  if (head === '*') {
    if (!Array.isArray(value)) {
      return;
    }
    for (const item of value) {
      collectRootsAtPath(item, tail, candidates);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  collectRootsAtPath(value[head], tail, candidates);
}

function extractRootCandidate(value) {
  if (value === rootDir) {
    return null;
  }

  if (value.endsWith(`${path.sep}Xqoder`)) {
    return value;
  }

  const stateMarker = `${path.sep}.omx${path.sep}state`;
  const markerIndex = value.indexOf(stateMarker);
  if (markerIndex > 0) {
    return value.slice(0, markerIndex);
  }

  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteStringValue(value, knownRoots) {
  let rewritten = value;

  for (const oldRoot of knownRoots) {
    const boundaryPattern = new RegExp(`${escapeRegExp(oldRoot)}(?=[\\\\/]|$)`, 'g');
    rewritten = rewritten.replace(boundaryPattern, rootDir);
  }

  return rewritten;
}

function rewriteJsonValue(value, knownRoots) {
  if (typeof value === 'string') {
    return rewriteStringValue(value, knownRoots);
  }

  if (Array.isArray(value)) {
    return value.map((item) => rewriteJsonValue(item, knownRoots));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, rewriteJsonValue(nestedValue, knownRoots)]),
  );
}

function repairStateFile(relativePath, knownRoots) {
  const absolutePath = path.join(stateDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return { repaired: null, error: null };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
    const rewritten = rewriteJsonValue(parsed, knownRoots);
    const originalSerialized = JSON.stringify(parsed);
    const rewrittenSerialized = JSON.stringify(rewritten);

    if (originalSerialized === rewrittenSerialized) {
      return { repaired: null, error: null };
    }

    if (!checkOnly) {
      fs.writeFileSync(absolutePath, `${JSON.stringify(rewritten, null, 2)}\n`, 'utf-8');
    }

    return {
      repaired: {
        file: path.relative(rootDir, absolutePath).replace(/\\/g, '/'),
      },
      error: null,
    };
  } catch (error) {
    return {
      repaired: null,
      error: {
        file: path.relative(rootDir, absolutePath).replace(/\\/g, '/'),
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

if (!fs.existsSync(stateDir)) {
  console.log('No local .omx/state directory found. Nothing to repair.');
  process.exit(0);
}

const { roots: knownRoots, errors: seedErrors } = collectKnownRoots();

if (seedErrors.length > 0) {
  console.warn('Warnings while collecting local runtime roots:');
  for (const error of seedErrors) {
    console.warn(`- ${error.file}: ${error.message}`);
  }

  if (checkOnly) {
    process.exit(1);
  }
}

if (knownRoots.length === 0) {
  console.log('Local runtime state already points at the current repo root.');
  process.exit(0);
}

const repairs = [];
const errors = [];

for (const relativePath of stateFiles) {
  const result = repairStateFile(relativePath, knownRoots);
  if (result.repaired) {
    repairs.push(result.repaired);
  }
  if (result.error) {
    errors.push(result.error);
  }
}

if (errors.length > 0) {
  console.warn('Warnings while scanning local runtime state:');
  for (const error of errors) {
    console.warn(`- ${error.file}: ${error.message}`);
  }

  if (checkOnly) {
    process.exit(1);
  }
}

if (repairs.length === 0) {
  console.log('No path replacements were needed after scanning local runtime state.');
  process.exit(0);
}

console.log(checkOnly ? 'Local runtime state requires repair:' : 'Local runtime state repaired:');
for (const repair of repairs) {
  console.log(`- ${repair.file}`);
}

if (checkOnly) {
  process.exit(1);
}
