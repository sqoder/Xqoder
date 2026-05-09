/**
 * XQoder build script (Bun version).
 * Bundles the CLI with Bun.build and resolves paths from tsconfig.json.
 */

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(import.meta.dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const pdfJsWorkerRelativePath = path.join('node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');

// Ensure the dist directory exists.
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

async function build() {
  console.log('🚀 Starting build with Bun...');

  try {
    const result = await Bun.build({
      entrypoints: [path.resolve(rootDir, 'src/index.ts')],
      outdir: distDir,
      target: 'node', // Keep it node-compatible for now just in case
      minify: false,
      sourcemap: 'external',
      external: [
        'react',
        'ink',
        'chalk',
        'commander',
        'clipboardy',
        'string-width',
        'openai',
        '@anthropic-ai/sdk',
        'better-sqlite3',
        'tree-kill',
        'fsevents',
        'typescript',
      ],
      define: {
        'process.env.NODE_ENV': '"production"',
      },
    });

    if (!result.success) {
      console.error('❌ Build failed:');
      for (const message of result.logs) {
        console.error(message);
      }
      process.exit(1);
    }

    const declarations = spawnSync('bun', [
      'x',
      'tsc',
      '-p',
      'tsconfig.json',
      '--emitDeclarationOnly',
    ], {
      cwd: rootDir,
      stdio: 'inherit',
    });

    if (declarations.status !== 0) {
      console.error('❌ Declaration emit failed.');
      process.exit(declarations.status ?? 1);
    }

    copyPdfJsWorkerAsset({ rootDir, distDir });

    console.log('✅ Build succeeded. Output: dist/index.js');
  } catch (err) {
    console.error('❌ Build failed:', err.message);
    process.exit(1);
  }
}

export function copyPdfJsWorkerAsset({
  rootDir,
  distDir,
} = {}) {
  const resolvedRootDir = rootDir ?? path.resolve(import.meta.dirname, '..');
  const resolvedDistDir = distDir ?? path.resolve(resolvedRootDir, 'dist');
  const sourcePath = path.resolve(resolvedRootDir, pdfJsWorkerRelativePath);
  const destPath = path.resolve(resolvedDistDir, 'pdf.worker.mjs');

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`PDF.js worker asset is missing: ${sourcePath}`);
  }

  fs.mkdirSync(resolvedDistDir, { recursive: true });
  fs.copyFileSync(sourcePath, destPath);
  return { sourcePath, destPath };
}

if (import.meta.main) {
  build();
}
