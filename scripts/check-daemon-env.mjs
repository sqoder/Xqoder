#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const daemonRequire = createRequire(path.join(repoRoot, 'packages', 'daemon', 'package.json'));

function parseNodeMajor(version) {
  const match = version.match(/^v?(\d+)\./);
  return match ? Number.parseInt(match[1] ?? '', 10) : null;
}

function detectNodePtyPackageDir() {
  try {
    return path.dirname(daemonRequire.resolve('node-pty/package.json'));
  } catch {
    return null;
  }
}

function detectNodePtyBuildMode() {
  const packageDir = detectNodePtyPackageDir();
  if (!packageDir) return 'missing';
  if (fs.existsSync(path.join(packageDir, 'build', 'Release', 'pty.node'))) {
    return 'source-build';
  }
  if (fs.existsSync(path.join(packageDir, 'prebuilds'))) {
    return 'prebuilt';
  }
  return 'unknown';
}

function warn(message) {
  process.stderr.write(`[XQoder postinstall] ${message}\n`);
}

function main() {
  const nodeVersion = process.version;
  const nodeMajor = parseNodeMajor(nodeVersion);
  const buildMode = detectNodePtyBuildMode();

  if (process.platform === 'win32') {
    warn('Windows currently uses the Node CLI path; daemon/client PTY mode is not part of the supported release matrix yet.');
  }

  if (nodeMajor !== 22) {
    warn(`Recommended Node version for daemon PTY mode is 22.x; current is ${nodeVersion}.`);
  }

  if (buildMode !== 'source-build') {
    warn(`node-pty build mode is ${buildMode}; source-build is recommended for stable PTY hosting.`);
    warn('Rebuild command: PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm_config_build_from_source=true pnpm rebuild node-pty --filter @xqoder/daemon');
  }

  if (nodeMajor === 22 && buildMode === 'source-build') {
    process.stdout.write('[XQoder postinstall] Daemon PTY environment looks healthy.\n');
  }
}

main()
