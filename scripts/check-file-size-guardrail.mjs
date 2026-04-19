import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const MAX_LINES = 1000;
const SCAN_PATHS = ['src', 'test'];
const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/i;

function listWorktreeFiles() {
  const tracked = execGit(['ls-files', '-z', '--', ...SCAN_PATHS]);
  const untracked = execGit(['ls-files', '-z', '--others', '--exclude-standard', '--', ...SCAN_PATHS]);
  return Array.from(new Set([...tracked, ...untracked].filter(Boolean)))
    .filter((filePath) => SOURCE_FILE_PATTERN.test(filePath))
    .sort();
}

function execGit(args) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  })
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function countLines(content) {
  if (content.length === 0) {
    return 0;
  }
  return content.split(/\r?\n/).length;
}

function getHeadLineCount(relativePath) {
  try {
    const content = execFileSync('git', ['show', `HEAD:${relativePath}`], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    return countLines(content);
  } catch {
    return null;
  }
}

const issues = [];

for (const relativePath of listWorktreeFiles()) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    continue;
  }

  const currentLineCount = countLines(fs.readFileSync(absolutePath, 'utf8'));
  if (currentLineCount <= MAX_LINES) {
    continue;
  }

  const headLineCount = getHeadLineCount(relativePath);
  const isNewHotspot = headLineCount === null;
  const hotspotGrew = headLineCount !== null && currentLineCount > headLineCount;

  if (isNewHotspot || hotspotGrew) {
    issues.push({
      file: relativePath,
      currentLineCount,
      headLineCount,
    });
  }
}

if (issues.length === 0) {
  console.log(`file-size guardrail: PASS (no new or growing ${MAX_LINES}+ line source files)`);
  process.exit(0);
}

console.error(`file-size guardrail: FAIL (${MAX_LINES}+ line hotspot regression detected)`);
for (const issue of issues) {
  const previous = issue.headLineCount === null ? 'new file' : `${issue.headLineCount} → ${issue.currentLineCount}`;
  console.error(`- ${issue.file} (${previous} lines)`);
}
process.exit(1);
