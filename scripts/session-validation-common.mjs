import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(__dirname, '..');

export function ensureBuiltFiles(paths) {
  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`required build artifact not found: ${filePath}`);
    }
  }
}

export async function importBuiltModule(...segments) {
  const filePath = path.join(repoRoot, ...segments);
  ensureBuiltFiles([filePath]);
  return import(pathToFileURL(filePath).href);
}
