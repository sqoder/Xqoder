#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(repoRoot, 'docs', 'artifacts', 'week5');

async function loadDeps() {
  const appStatePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'app-state.js');
  const rendererPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'renderer.js');
  const themePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'renderer-boxes.js');
  const viewportModelPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'viewport-model.js');
  const rustTuiPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'rust-tui.js');
  const runtimeBridgePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'runtime-bridge.js');
  const reducerPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-app', 'reducer.js');
  const mouseHandlerPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-app', 'mouse-handler.js');

  const [
    { createInitialTerminalAppState },
    { renderTerminalFrame },
    { getTheme },
    { buildScrollbarModel, resolveViewportTopLineFromScrollbar },
    { rustTui },
    { withDerivedChrome },
    { reduceTerminalAppState },
    { MouseHandler },
  ] = await Promise.all([
    import(pathToFileURL(appStatePath).href),
    import(pathToFileURL(rendererPath).href),
    import(pathToFileURL(themePath).href),
    import(pathToFileURL(viewportModelPath).href),
    import(pathToFileURL(rustTuiPath).href),
    import(pathToFileURL(runtimeBridgePath).href),
    import(pathToFileURL(reducerPath).href),
    import(pathToFileURL(mouseHandlerPath).href),
  ]);

  return {
    createInitialTerminalAppState,
    renderTerminalFrame,
    getTheme,
    buildScrollbarModel,
    resolveViewportTopLineFromScrollbar,
    rustTui,
    withDerivedChrome,
    reduceTerminalAppState,
    MouseHandler,
  };
}

function writeSnapshot(name, lines) {
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${name}.txt`);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

async function main() {
  const {
    createInitialTerminalAppState,
    renderTerminalFrame,
    getTheme,
    buildScrollbarModel,
    resolveViewportTopLineFromScrollbar,
    rustTui,
    withDerivedChrome,
    reduceTerminalAppState,
    MouseHandler,
  } = await loadDeps();
  const theme = getTheme('default');

  const commandsState = createInitialTerminalAppState({ width: 120, height: 30 });
  commandsState.overlay = {
    type: 'commands',
    query: '',
    selectedIndex: 0,
    allItems: [
      { id: 'pro.workflow.deploy', label: 'Deploy Workflow', description: 'One-click CI/CD deploy', pro: true },
      { id: 'session', label: 'Switch Session', description: 'Open recent sessions' },
    ],
    items: [
      { id: 'pro.workflow.deploy', label: 'Deploy Workflow', description: 'One-click CI/CD deploy', pro: true },
      { id: 'session', label: 'Switch Session', description: 'Open recent sessions' },
    ],
  };
  const commandsOut = renderTerminalFrame(commandsState, theme).buffer.toLines();
  const proFile = writeSnapshot('commands-pro-visual', [
    '[Week5 evidence] Pro command shows [Pro] marker instead of disabled state',
    ...commandsOut,
  ]);

  const lineCount = 260;
  const viewportHeight = 22;
  const scrollbar = buildScrollbarModel(lineCount, viewportHeight, 0);
  const dragRows = [1, Math.max(1, Math.floor(scrollbar.trackHeight / 2)), Math.max(1, scrollbar.trackHeight - 1)];
  const dragEvidence = dragRows.map((pointerRow) => {
    const topLine = resolveViewportTopLineFromScrollbar(lineCount, viewportHeight, pointerRow, 0);
    return `pointerRow=${pointerRow} -> topLine=${topLine}`;
  });
  const inertia = rustTui.inertialScrollDeltas(6, 6);
  const interactionFile = writeSnapshot('scrollbar-inertia-evidence', [
    '[Week5 evidence] Scrollbar drag topLine mapping + wheel inertia decay',
    `trackHeight=${scrollbar.trackHeight}, thumbHeight=${scrollbar.thumbHeight}`,
    ...dragEvidence,
    `inertialDeltas=${JSON.stringify(inertia)}`,
  ]);

  let toggleState = createInitialTerminalAppState({ width: 120, height: 30 });
  toggleState.transcriptEntries = [
    { id: 's1:tool:read_file:1', role: 'tool', content: 'read_file /repo/src/a.ts' },
    { id: 's1:tool:read_file:2', role: 'tool', content: 'read_file /repo/src/b.ts' },
    { id: 's1:tool:read_file:3', role: 'tool', content: 'read_file /repo/src/c.ts' },
  ];
  toggleState = withDerivedChrome(toggleState);

  const mouseHandler = new MouseHandler({
    dispatch: (event) => {
      toggleState = reduceTerminalAppState(toggleState, event);
    },
  });
  const markerLine = toggleState.transcriptLines.findIndex((line) => line.includes('◈ Gathered context'));
  const collapsedFirst = renderTerminalFrame(toggleState, theme).buffer.toLines();
  if (markerLine >= 0) {
    mouseHandler.handleTranscriptClick(toggleState, markerLine);
  }
  const expanded = renderTerminalFrame(toggleState, theme).buffer.toLines();
  if (markerLine >= 0) {
    mouseHandler.handleTranscriptClick(toggleState, markerLine);
  }
  const collapsedAgain = renderTerminalFrame(toggleState, theme).buffer.toLines();
  const toggleFile = writeSnapshot('tool-call-toggle-visual', [
    '[Week5 evidence] Click tool-call context group: first click expands, second click collapses',
    '',
    '--- collapsed (before click) ---',
    ...collapsedFirst,
    '',
    '--- expanded (after first click) ---',
    ...expanded,
    '',
    '--- collapsed again (after second click) ---',
    ...collapsedAgain,
  ]);

  process.stdout.write('Week5 artifacts generated:\n');
  process.stdout.write(`- ${proFile}\n`);
  process.stdout.write(`- ${interactionFile}\n`);
  process.stdout.write(`- ${toggleFile}\n`);
}

main().catch((error) => {
  process.stderr.write(`Failed to capture Week5 artifacts: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
