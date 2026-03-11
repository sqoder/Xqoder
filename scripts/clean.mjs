#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

removeIfExists(path.join(rootDir, 'dist'));
removeChildDistDirectories(path.join(rootDir, 'packages'));
removeChildDistDirectories(path.join(rootDir, 'apps'));

function removeChildDistDirectories(parentDir) {
  if (!fs.existsSync(parentDir)) {
    return;
  }

  for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    removeIfExists(path.join(parentDir, entry.name, 'dist'));
  }
}

function removeIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
}
