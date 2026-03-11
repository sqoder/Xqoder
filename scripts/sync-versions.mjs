#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPackagePath = path.join(rootDir, 'package.json');
const rootPackage = readJson(rootPackagePath);
const workspaceVersion = rootPackage.version;

if (typeof workspaceVersion !== 'string' || !workspaceVersion.trim()) {
  throw new Error(`根 package.json 缺少有效 version: ${rootPackagePath}`);
}

syncChildPackages(path.join(rootDir, 'packages'), workspaceVersion);
syncChildPackages(path.join(rootDir, 'apps'), workspaceVersion);

function syncChildPackages(parentDir, version) {
  if (!fs.existsSync(parentDir)) {
    return;
  }

  for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = path.join(parentDir, entry.name, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = readJson(packageJsonPath);
    if (packageJson.version === version) {
      continue;
    }

    packageJson.version = version;
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 4)}\n`, 'utf-8');
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
