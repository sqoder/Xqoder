/**
 * XQoder build script (Bun version).
 * Bundles the CLI with Bun.build and resolves paths from tsconfig.json.
 */

import path from 'path';
import fs from 'fs';

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

    // Bun's outdir naming for single entrypoint results in index.js usually
    // but check if it's correct. Bun names it index.js if entrypoint is index.ts.
    console.log('✅ Build succeeded. Output: dist/index.js');
  } catch (err) {
    console.error('❌ Build failed:', err.message);
    process.exit(1);
  }
}

build();
