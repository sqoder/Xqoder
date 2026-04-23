/**
 * XQoder build script (Bun version).
 * Bundles the CLI with Bun.build and resolves paths from tsconfig.json.
 */

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(import.meta.dirname, '..');
const distDir = path.resolve(rootDir, 'dist');

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

    console.log('✅ Build succeeded. Output: dist/index.js');
  } catch (err) {
    console.error('❌ Build failed:', err.message);
    process.exit(1);
  }
}

build();
