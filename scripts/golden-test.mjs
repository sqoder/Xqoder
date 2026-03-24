#!/usr/bin/env node

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const goldenDir = path.join(repoRoot, 'docs', 'artifacts', 'golden');
const require = createRequire(import.meta.url);

function parseArgs(input) {
  const out = { update: false };
  for (let i = 0; i < input.length; i += 1) {
    const token = input[i];
    if (token === '--update') out.update = true;
  }
  return out;
}

async function loadDeps() {
  const appStatePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'app-state.js');
  const runtimeBridgePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'runtime-bridge.js');
  const rendererPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'renderer.js');
  const rustRendererPath = path.join(repoRoot, 'packages', 'renderer', 'index.js');

  const [
    { createInitialTerminalAppState },
    { withDerivedChrome },
    { mapAppStateToTUIState },
  ] = await Promise.all([
    import(pathToFileURL(appStatePath).href),
    import(pathToFileURL(runtimeBridgePath).href),
    import(pathToFileURL(rendererPath).href),
  ]);

  const {
    XqRenderer,
    computeTuiLayout,
    hitTest,
    computeScrollbarThumb,
    resolveViewportTopLineFromScrollbar,
    resolveViewportTopLineForJump,
  } = require(rustRendererPath);
  if (typeof XqRenderer !== 'function') {
    throw new Error('Rust renderer binding is missing XqRenderer constructor. Rebuild with pnpm build:renderer.');
  }

  const queryFns = {
    computeTuiLayout,
    hitTest,
    computeScrollbarThumb,
    resolveViewportTopLineFromScrollbar,
    resolveViewportTopLineForJump,
  };
  for (const [name, fn] of Object.entries(queryFns)) {
    if (typeof fn !== 'function') {
      throw new Error(`Rust renderer binding is missing ${name}(). Rebuild with pnpm build:renderer.`);
    }
  }

  return { createInitialTerminalAppState, withDerivedChrome, mapAppStateToTUIState, XqRenderer, queryFns };
}

function normalizeLines(lines) {
  return `${lines.join('\n')}\n`;
}

function normalizeJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function readNumber(value, camel, snake) {
  if (!value || typeof value !== 'object') {
    return 0;
  }
  const source = value;
  const raw = source[camel] ?? source[snake];
  return typeof raw === 'number' ? raw : 0;
}

function normalizeHitResult(result) {
  if (!result || typeof result !== 'object') {
    return { kind: 'none' };
  }
  const ratio = result.ratio;
  return {
    kind: result.kind ?? 'none',
    lineOffset: typeof result.lineOffset === 'number' ? result.lineOffset : undefined,
    row: typeof result.row === 'number' ? result.row : undefined,
    ratio: typeof ratio === 'number' ? Number(ratio.toFixed(4)) : undefined,
  };
}

function renderRustFrameSnapshots(state, mapAppStateToTUIState, XqRenderer) {
  // Golden capture should assert renderer truth, not terminal IO side effects.
  process.env.XQODER_RENDERER_SINK_OUTPUT = '1';
  const tuiState = mapAppStateToTUIState(state);
  const renderer = new XqRenderer(state.size.width, state.size.height);
  renderer.commitState(tuiState);
  if (typeof renderer.snapshotFrameLines !== 'function') {
    throw new Error('Rust renderer binding is missing snapshotFrameLines(). Rebuild with pnpm build:renderer.');
  }
  if (typeof renderer.snapshotFrameStyledLines !== 'function') {
    throw new Error('Rust renderer binding is missing snapshotFrameStyledLines(). Rebuild with pnpm build:renderer.');
  }
  return {
    plain: renderer.snapshotFrameLines(),
    styled: renderer.snapshotFrameStyledLines(),
  };
}

function buildRendererQueryFixture(queryFns) {
  const layout = queryFns.computeTuiLayout(140, 30, 2, null, null);
  if (!layout) {
    throw new Error('computeTuiLayout returned null while building renderer query fixture.');
  }
  const scrollbar = layout.messagesScrollbar;
  if (!scrollbar) {
    throw new Error('computeTuiLayout did not return messagesScrollbar for renderer query fixture.');
  }

  const hitPoints = [
    { id: 'message-center', col: layout.messages.x + 2, row: layout.messages.y + 2 },
    { id: 'scrollbar-thumb-mid', col: scrollbar.x, row: scrollbar.y + 1 },
    { id: 'input-area', col: layout.input.x + 1, row: layout.input.y + 1 },
    { id: 'header', col: layout.header.x + 1, row: layout.header.y },
    { id: 'footer', col: layout.footer.x + 1, row: layout.footer.y },
    { id: 'sidebar', col: layout.sidebar.x + 1, row: layout.sidebar.y + 1 },
    { id: 'outside', col: 0, row: 40 },
  ];

  const hitTests = hitPoints.map((point) => ({
    id: point.id,
    col: point.col,
    row: point.row,
    result: normalizeHitResult(
      queryFns.hitTest(140, 30, 2, null, null, point.col, point.row),
    ),
  }));

  const jumpLineCount = 120;
  const jumpHeight = 20;
  const jumpTargets = [0, 4, 17, 60, 119];
  const jumpCases = jumpTargets.map((targetLine) => ({
    targetLine,
    topLine: queryFns.resolveViewportTopLineForJump(jumpLineCount, jumpHeight, targetLine, 1, 3),
  }));

  const scrollbarLineCount = 120;
  const scrollbarHeight = 20;
  const scrollOffsets = [0, 7, 42, 88, 100];
  const scrollbarCases = scrollOffsets.map((scrollTop) => {
    const thumb = queryFns.computeScrollbarThumb(scrollbarLineCount, scrollbarHeight, scrollTop, scrollbarHeight);
    const thumbTop = readNumber(thumb, 'thumbTop', 'thumb_top');
    const thumbHeight = readNumber(thumb, 'thumbHeight', 'thumb_height');
    const trackHeight = readNumber(thumb, 'trackHeight', 'track_height');
    const pointerRow = Math.max(0, Math.floor(thumbTop + thumbHeight / 2));
    const resolvedTop = queryFns.resolveViewportTopLineFromScrollbar(
      scrollbarLineCount,
      scrollbarHeight,
      pointerRow,
      0,
    );
    const nextThumb = queryFns.computeScrollbarThumb(
      scrollbarLineCount,
      scrollbarHeight,
      resolvedTop,
      scrollbarHeight,
    );
    return {
      scrollTop,
      thumb: {
        visible: !!thumb.visible,
        thumbTop,
        thumbHeight,
        trackHeight,
      },
      pointerRow,
      resolvedTop,
      nextThumbTop: readNumber(nextThumb, 'thumbTop', 'thumb_top'),
    };
  });

  return {
    layout: {
      messages: layout.messages,
      messagesScrollbar: layout.messagesScrollbar,
      input: layout.input,
      header: layout.header,
      footer: layout.footer,
      sidebar: layout.sidebar,
      hasSidebar: layout.hasSidebar,
    },
    hitTests,
    jumpCases,
    scrollbarCases,
  };
}

function findFirstDiff(expected, actual) {
  const e = expected.split('\n');
  const a = actual.split('\n');
  const max = Math.max(e.length, a.length);
  for (let i = 0; i < max; i += 1) {
    if ((e[i] ?? '') !== (a[i] ?? '')) {
      return {
        line: i + 1,
        expected: e[i] ?? '(missing)',
        actual: a[i] ?? '(missing)',
      };
    }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {
    createInitialTerminalAppState,
    withDerivedChrome,
    mapAppStateToTUIState,
    XqRenderer,
    queryFns,
  } = await loadDeps();

  const cases = [
    {
      name: 'empty-start',
      build: () => createInitialTerminalAppState({ width: 120, height: 30 }),
    },
    {
      name: 'chinese-message',
      build: () => {
        let state = createInitialTerminalAppState({ width: 120, height: 30 });
        state.transcriptEntries = [
          { id: 'u1', role: 'user', content: '你好，帮我检查这个函数。' },
          { id: 'a1', role: 'assistant', content: '已检查，建议补充边界条件测试。' },
        ];
        return withDerivedChrome(state);
      },
    },
    {
      name: 'autocomplete-complete-overlay',
      build: () => {
        const state = createInitialTerminalAppState({ width: 120, height: 30 });
        state.editor.value = '@src';
        state.editor.cursorOffset = state.editor.value.length;
        state.editor.cursorPartOffset = state.editor.value.length;
        state.overlay = {
          type: 'complete',
          currentDir: '/repo',
          selectedIndex: 1,
          scrollOffset: 0,
          expandedDirs: ['/repo/src'],
          items: [
            { path: '/repo/src', label: 'src', isDir: true, depth: 0 },
            { path: '/repo/src/app.ts', label: 'app.ts', isDir: false, depth: 1 },
            { path: '/repo/src/utils.ts', label: 'utils.ts', isDir: false, depth: 1 },
          ],
        };
        return state;
      },
    },
    {
      name: 'shell-mode-active',
      build: () => {
        const state = createInitialTerminalAppState({ width: 120, height: 30 });
        state.editor.value = '!npm run test';
        state.editor.cursorOffset = state.editor.value.length;
        state.editor.cursorPartOffset = state.editor.value.length;
        return state;
      },
    },
  ];

  fs.mkdirSync(goldenDir, { recursive: true });

  let failures = 0;
  for (const testCase of cases) {
    const state = testCase.build();
    const snapshots = renderRustFrameSnapshots(state, mapAppStateToTUIState, XqRenderer);
    const plainActual = normalizeLines(snapshots.plain);
    const styledActual = normalizeLines(snapshots.styled);
    const plainFile = path.join(goldenDir, `${testCase.name}.txt`);
    const styledFile = path.join(goldenDir, `${testCase.name}.style.txt`);

    if (args.update || !fs.existsSync(plainFile) || !fs.existsSync(styledFile)) {
      fs.writeFileSync(plainFile, plainActual, 'utf-8');
      fs.writeFileSync(styledFile, styledActual, 'utf-8');
      process.stdout.write(`✓ updated ${path.relative(repoRoot, plainFile)}\n`);
      process.stdout.write(`✓ updated ${path.relative(repoRoot, styledFile)}\n`);
      continue;
    }

    const plainExpected = fs.readFileSync(plainFile, 'utf-8');
    const styledExpected = fs.readFileSync(styledFile, 'utf-8');
    try {
      assert.equal(plainActual, plainExpected);
      assert.equal(styledActual, styledExpected);
      process.stdout.write(`✓ golden ${testCase.name}\n`);
    } catch {
      failures += 1;
      const plainDiff = findFirstDiff(plainExpected, plainActual);
      const styledDiff = findFirstDiff(styledExpected, styledActual);
      const plainActualPath = path.join(goldenDir, `${testCase.name}.actual.txt`);
      const styledActualPath = path.join(goldenDir, `${testCase.name}.style.actual.txt`);
      fs.writeFileSync(plainActualPath, plainActual, 'utf-8');
      fs.writeFileSync(styledActualPath, styledActual, 'utf-8');
      process.stderr.write(`✗ golden mismatch: ${testCase.name}\n`);
      if (plainDiff) {
        process.stderr.write(`  plain first diff at line ${plainDiff.line}\n`);
      }
      if (styledDiff) {
        process.stderr.write(`  styled first diff at line ${styledDiff.line}\n`);
      }
      process.stderr.write(`  actual plain snapshot: ${path.relative(repoRoot, plainActualPath)}\n`);
      process.stderr.write(`  actual styled snapshot: ${path.relative(repoRoot, styledActualPath)}\n`);
    }
  }

  const queryFixtureActual = normalizeJson(buildRendererQueryFixture(queryFns));
  const queryFixtureFile = path.join(goldenDir, 'renderer-queries.json');
  if (args.update || !fs.existsSync(queryFixtureFile)) {
    fs.writeFileSync(queryFixtureFile, queryFixtureActual, 'utf-8');
    process.stdout.write(`✓ updated ${path.relative(repoRoot, queryFixtureFile)}\n`);
  } else {
    const queryFixtureExpected = fs.readFileSync(queryFixtureFile, 'utf-8');
    try {
      assert.equal(queryFixtureActual, queryFixtureExpected);
      process.stdout.write('✓ golden renderer-queries\n');
    } catch {
      failures += 1;
      const queryActualPath = path.join(goldenDir, 'renderer-queries.actual.json');
      fs.writeFileSync(queryActualPath, queryFixtureActual, 'utf-8');
      process.stderr.write('✗ golden mismatch: renderer-queries\n');
      process.stderr.write(`  actual fixture: ${path.relative(repoRoot, queryActualPath)}\n`);
    }
  }

  if (failures > 0) {
    process.stderr.write(`\n${failures} golden case(s) failed. Run: pnpm golden:update\n`);
    process.exit(1);
  }

  process.stdout.write('\nGolden snapshots are all up to date.\n');
}

main().catch((error) => {
  process.stderr.write(`golden test failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
