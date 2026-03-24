import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyThemeSliceOperations,
  buildThemeSliceOperations,
} from './theme-pr-extract-common.mjs';

test('buildThemeSliceOperations marks existing paths as copy and missing paths as delete', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-theme-extract-repo-'));
  try {
    fs.mkdirSync(path.join(repoRoot, 'packages/cli/src'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'packages/renderer'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'packages/cli/src/app.ts'), 'export const app = 1;\n', 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'packages/renderer/index.darwin-arm64.node'), 'binary', 'utf8');

    const theme = {
      paths: [
        'packages/cli/src/app.ts',
        'packages/cli/src/missing.ts',
        'packages/renderer/index.darwin-arm64.node',
      ],
    };

    const operations = buildThemeSliceOperations(theme, repoRoot);
    assert.deepEqual(operations.map((entry) => [entry.path, entry.action]), [
      ['packages/cli/src/app.ts', 'copy'],
      ['packages/cli/src/missing.ts', 'delete'],
    ]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('applyThemeSliceOperations copies files and deletes removed paths in target tree', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-theme-extract-src-'));
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-theme-extract-dst-'));
  try {
    fs.mkdirSync(path.join(repoRoot, 'docs/artifacts/release'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'docs/artifacts/release/latest-index.md'), '# updated\n', 'utf8');

    fs.mkdirSync(path.join(targetRoot, 'docs/artifacts/release'), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, 'docs/artifacts/release/latest-index.md'), '# old\n', 'utf8');
    fs.writeFileSync(path.join(targetRoot, 'docs/artifacts/release/obsolete.md'), 'remove me\n', 'utf8');

    const operations = [
      {
        path: 'docs/artifacts/release/latest-index.md',
        sourcePath: path.join(repoRoot, 'docs/artifacts/release/latest-index.md'),
        action: 'copy',
      },
      {
        path: 'docs/artifacts/release/obsolete.md',
        sourcePath: path.join(repoRoot, 'docs/artifacts/release/obsolete.md'),
        action: 'delete',
      },
    ];

    applyThemeSliceOperations({
      operations,
      targetRoot,
    });

    assert.equal(
      fs.readFileSync(path.join(targetRoot, 'docs/artifacts/release/latest-index.md'), 'utf8'),
      '# updated\n',
    );
    assert.equal(fs.existsSync(path.join(targetRoot, 'docs/artifacts/release/obsolete.md')), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

test('applyThemeSliceOperations skips generated renderer artifacts when copying directories', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-theme-extract-renderer-src-'));
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-theme-extract-renderer-dst-'));
  try {
    fs.mkdirSync(path.join(repoRoot, 'packages/renderer/src'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'packages/renderer/target/release'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'packages/renderer/src/bindings.rs'), '// source\n', 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'packages/renderer/index.darwin-arm64.node'), 'binary', 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'packages/renderer/target/release/libxqoder_renderer.dylib'), 'artifact', 'utf8');

    const operations = [
      {
        path: 'packages/renderer',
        sourcePath: path.join(repoRoot, 'packages/renderer'),
        action: 'copy',
      },
    ];

    applyThemeSliceOperations({
      operations,
      targetRoot,
    });

    assert.equal(
      fs.readFileSync(path.join(targetRoot, 'packages/renderer/src/bindings.rs'), 'utf8'),
      '// source\n',
    );
    assert.equal(
      fs.existsSync(path.join(targetRoot, 'packages/renderer/index.darwin-arm64.node')),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(targetRoot, 'packages/renderer/target/release/libxqoder_renderer.dylib')),
      false,
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});
