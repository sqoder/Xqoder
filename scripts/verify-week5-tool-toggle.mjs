#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

async function loadDeps() {
  const appStatePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'app-state.js');
  const runtimeBridgePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'runtime-bridge.js');
  const reducerPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-app', 'reducer.js');
  const mouseHandlerPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-app', 'mouse-handler.js');

  const [
    { createInitialTerminalAppState },
    { withDerivedChrome },
    { reduceTerminalAppState },
    { MouseHandler },
  ] = await Promise.all([
    import(pathToFileURL(appStatePath).href),
    import(pathToFileURL(runtimeBridgePath).href),
    import(pathToFileURL(reducerPath).href),
    import(pathToFileURL(mouseHandlerPath).href),
  ]);

  return { createInitialTerminalAppState, withDerivedChrome, reduceTerminalAppState, MouseHandler };
}

async function main() {
  const { createInitialTerminalAppState, withDerivedChrome, reduceTerminalAppState, MouseHandler } = await loadDeps();

  let state = createInitialTerminalAppState({ width: 120, height: 30 });
  state.transcriptEntries = [
    { id: 's1:tool:read_file:1', role: 'tool', content: 'read_file /repo/src/a.ts' },
    { id: 's1:tool:read_file:2', role: 'tool', content: 'read_file /repo/src/b.ts' },
    { id: 's1:tool:read_file:3', role: 'tool', content: 'read_file /repo/src/c.ts' },
  ];
  state = withDerivedChrome(state);

  const markerLine = state.transcriptLines.findIndex((line) => line.includes('◈ Gathered context'));
  assert.ok(markerLine >= 0, 'Expected collapsed context-group marker in transcript');

  const handler = new MouseHandler({
    dispatch: (event) => {
      state = reduceTerminalAppState(state, event);
    },
  });

  const first = handler.handleTranscriptClick(state, markerLine);
  assert.equal(first, true, 'Expected first click to expand context group');
  assert.match(state.transcriptLines.join('\n'), /◈ Gathered context/u, 'Expected expanded marker after first click');
  assert.match(state.transcriptLines.join('\n'), /read_file \/repo\/src\/a\.ts/u, 'Expected detail line visible after expansion');

  const second = handler.handleTranscriptClick(state, markerLine);
  assert.equal(second, true, 'Expected second click to collapse context group');
  assert.match(state.transcriptLines.join('\n'), /◈ Gathered context/u, 'Expected collapsed marker after second click');

  process.stdout.write('✓ Tool call click toggles collapsed -> expanded -> collapsed\n');
}

main().catch((error) => {
  process.stderr.write(`✗ verify:week5:tool-toggle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
