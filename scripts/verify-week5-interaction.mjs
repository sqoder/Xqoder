#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

async function loadDeps() {
  const appStatePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'app-state.js');
  const rendererPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'renderer.js');
  const transcriptViewportQueriesPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'transcript-viewport-queries.js');
  const rustTuiPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'rust-tui.js');

  const [
    { createInitialTerminalAppState },
    { mapAppStateToTUIState },
    { buildTranscriptScrollbarModel, resolveTranscriptTopLineFromScrollbar },
    { rustTui },
  ] = await Promise.all([
    import(pathToFileURL(appStatePath).href),
    import(pathToFileURL(rendererPath).href),
    import(pathToFileURL(transcriptViewportQueriesPath).href),
    import(pathToFileURL(rustTuiPath).href),
  ]);

  return {
    createInitialTerminalAppState,
    mapAppStateToTUIState,
    buildTranscriptScrollbarModel,
    resolveTranscriptTopLineFromScrollbar,
    rustTui,
  };
}

async function main() {
  const {
    createInitialTerminalAppState,
    mapAppStateToTUIState,
    buildTranscriptScrollbarModel,
    resolveTranscriptTopLineFromScrollbar,
    rustTui,
  } = await loadDeps();

  const deltas = rustTui.inertialScrollDeltas(6, 6);
  assert.ok(Array.isArray(deltas) && deltas.length >= 2, 'Expected multiple inertial scroll deltas');
  assert.ok(Math.abs(deltas[0]) >= Math.abs(deltas[deltas.length - 1]), 'Expected inertial tail to decay');
  process.stdout.write('✓ Wheel inertia deltas decay\n');

  const lineCount = 260;
  const viewportHeight = 22;
  const scrollbar = buildTranscriptScrollbarModel(lineCount, viewportHeight, 0);
  assert.equal(scrollbar.visible, true, 'Expected scrollbar to be visible for long transcript');
  const topNearTop = resolveTranscriptTopLineFromScrollbar(lineCount, viewportHeight, 1, 0);
  const topNearBottom = resolveTranscriptTopLineFromScrollbar(lineCount, viewportHeight, scrollbar.trackHeight - 1, 0);
  assert.ok(topNearBottom > topNearTop, 'Expected drag near bottom to map to larger top line');
  process.stdout.write('✓ Scrollbar drag resolves topLine progression\n');

  const state = createInitialTerminalAppState({ width: 120, height: 30 });
  state.overlay = {
    type: 'commands',
    query: '',
    selectedIndex: 0,
    allItems: [
      { id: 'pro.workflow.deploy', label: 'Deploy Workflow', description: 'One-click CI/CD deploy', pro: true },
      { id: 'session', label: 'Switch Session', description: 'Open sessions' },
    ],
    items: [
      { id: 'pro.workflow.deploy', label: 'Deploy Workflow', description: 'One-click CI/CD deploy', pro: true },
      { id: 'session', label: 'Switch Session', description: 'Open sessions' },
    ],
  };
  const tuiState = mapAppStateToTUIState(state);
  assert.ok(Array.isArray(tuiState.overlay?.items), 'Expected overlay items to be mapped for renderer state');
  assert.ok(
    tuiState.overlay.items.some((item) => typeof item === 'string' && item.includes('[Pro] Deploy Workflow')),
    'Expected commands overlay to expose [Pro] marker in renderer view model',
  );
  process.stdout.write('✓ Commands overlay shows [Pro] marker\n');
}

main().catch((error) => {
  process.stderr.write(`✗ verify:week5:interaction failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
