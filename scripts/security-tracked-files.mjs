import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const TRACKED_SCAN_PATHS = [
  '.github/workflows',
  'docs',
  'scripts',
  'src',
  'test',
  'README.md',
  'ARCHITECTURE.md',
  'package.json',
  'tsconfig.json',
  'tsconfig.domain-shared-strict.json',
];

const SECRET_PATTERNS = [
  { name: 'OpenAI-style secret', pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g },
  { name: 'GitHub personal access token', pattern: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { name: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

const TRACKED_FILE_NAME_PATTERNS = [
  { name: 'Tracked .env file', pattern: /(^|\/)\.env(\..+)?$/ },
  { name: 'Tracked private key file', pattern: /\.(pem|key)$/i },
];

function listTrackedFiles() {
  const raw = execFileSync('git', ['ls-files', '-z', '--', ...TRACKED_SCAN_PATHS], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });

  return raw
    .split('\0')
    .map((filePath) => filePath.trim())
    .filter(Boolean);
}

function isTextFile(buffer) {
  return !buffer.includes(0);
}

function createLineNumberIndex(content, matchIndex) {
  let line = 1;
  for (let index = 0; index < matchIndex; index += 1) {
    if (content[index] === '\n') {
      line += 1;
    }
  }
  return line;
}

function collectIssues() {
  const issues = [];
  const trackedFiles = listTrackedFiles();

  for (const relativePath of trackedFiles) {
    const normalizedPath = relativePath.replace(/\\/g, '/');

    for (const { name, pattern } of TRACKED_FILE_NAME_PATTERNS) {
      if (pattern.test(normalizedPath)) {
        issues.push({
          file: normalizedPath,
          reason: name,
        });
      }
    }

    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      continue;
    }

    const buffer = fs.readFileSync(absolutePath);
    if (!isTextFile(buffer)) {
      continue;
    }

    const content = buffer.toString('utf8');
    for (const { name, pattern } of SECRET_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        issues.push({
          file: normalizedPath,
          line: createLineNumberIndex(content, match.index ?? 0),
          reason: name,
        });
      }
    }
  }

  return issues;
}

const issues = collectIssues();

if (issues.length === 0) {
  console.log('tracked-files security hygiene: PASS');
  process.exit(0);
}

console.error('tracked-files security hygiene: FAIL');
for (const issue of issues) {
  const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
  console.error(`- ${location} — ${issue.reason}`);
}
process.exit(1);
