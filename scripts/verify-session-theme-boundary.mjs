#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const targetPaths = [
  'packages/agent/src/session',
  'packages/agent/src/project-memory.ts',
  'packages/agent/src/project-memory.test.ts',
  'packages/shared/src/index.ts',
  'packages/shared/src/project-memory.ts',
  'packages/runtime/src/core/session-store.ts',
  'packages/cli/src/session-assets.ts',
  'packages/cli/src/session-bundle.ts',
  'packages/cli/src/services/chat-service.ts',
  'packages/cli/src/services/runtime-session-kernel.ts',
  'packages/cli/src/services/session-resolve.ts',
  'packages/cli/src/commands/acp.ts',
  'packages/cli/src/commands/export.ts',
  'packages/cli/src/commands/import.ts',
  'packages/cli/src/commands/sessions.ts',
  'packages/cli/src/commands/share.ts',
  'packages/cli/src/commands/stats.ts',
];

const scans = [
  {
    description: 'legacy getSession()/loadSession() usage',
    args: [
      '(?:\\.getSession(?:\\?\\.)?|\\bgetSession\\??|\\.loadSession(?:\\?\\.)?|\\bloadSession\\??)\\(',
    ],
  },
  {
    description: 'deprecated session compatibility API usage',
    args: [
      '\\.(?:findLatestSession|createEmptySession|saveSessionFromKernel|saveSession)(?:\\?\\.)?\\(',
    ],
  },
  {
    description: 'legacy session adapter/type usage',
    args: [
      '\\b(?:LegacyAgentSessionStore|LegacyAgentSessionCompatibilityStore|createLegacyAgentSessionStoreAdapter)\\b',
    ],
  },
  {
    description: 'legacy session adapter deep import',
    fixedStrings: true,
    args: [
      '@xqoder/agent/src/session/legacy-store-adapter',
      '@xqoder/agent/session/legacy-store-adapter',
      '@xqoder/agent/dist/session/legacy-store-adapter',
      'session/legacy-store-adapter',
    ],
  },
];

const failures = [];

for (const scanConfig of scans) {
  const scan = spawnSync('rg', [
    '--no-heading',
    '--line-number',
    '--color',
    'never',
    ...(scanConfig.fixedStrings ? ['--fixed-strings'] : []),
    '--glob',
    '!**/*.test.ts',
    '--glob',
    '!**/*.spec.ts',
    ...scanConfig.args.flatMap((pattern) => (scanConfig.fixedStrings ? ['-e', pattern] : [pattern])),
    ...targetPaths,
  ], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });

  if (scan.status !== 0 && scan.status !== 1) {
    process.stderr.write(scan.stderr || scan.stdout || `Failed to scan ${scanConfig.description}.\n`);
    process.exit(scan.status ?? 1);
  }

  const output = scan.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (output.length > 0) {
    failures.push({
      description: scanConfig.description,
      output,
    });
  }
}

if (failures.length === 0) {
  process.stdout.write('Session truth-source boundary check passed: no legacy session APIs or imports found in theme-owned sources.\n');
  process.exit(0);
}

process.stderr.write('\nSession truth-source boundary check failed.\n');
for (const failure of failures) {
  process.stderr.write(`\nFound ${failure.description}:\n`);
  for (const line of failure.output) {
    process.stderr.write(`- ${line}\n`);
  }
}
process.stderr.write('\nMigrate these session-truth-source files fully onto snapshot/runtime interfaces before extracting the theme.\n');
process.exit(1);
