#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(repoRoot, 'docs', 'artifacts', 'week3');

async function loadRendererDeps() {
  const appStatePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'app-state.js');
  const rendererPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'renderer.js');
  const themePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'renderer-boxes.js');
  const reducerPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-app', 'reducer.js');

  const [{ createInitialTerminalAppState }, { renderTerminalFrame }, { getTheme }, { reduceTerminalAppState }] = await Promise.all([
    import(pathToFileURL(appStatePath).href),
    import(pathToFileURL(rendererPath).href),
    import(pathToFileURL(themePath).href),
    import(pathToFileURL(reducerPath).href),
  ]);

  return { createInitialTerminalAppState, renderTerminalFrame, getTheme, reduceTerminalAppState };
}

function writeSnapshot(name, lines) {
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${name}.txt`);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

async function main() {
  const { createInitialTerminalAppState, renderTerminalFrame, getTheme, reduceTerminalAppState } = await loadRendererDeps();
  const theme = getTheme('default');

  const shellState = createInitialTerminalAppState({ width: 120, height: 30 });
  shellState.editor.value = '!ls -la';
  shellState.editor.cursorOffset = shellState.editor.value.length;
  shellState.editor.cursorPartOffset = shellState.editor.value.length;
  const shellOut = renderTerminalFrame(shellState, theme).buffer.toLines();
  const shellFile = writeSnapshot('shell-mode-visual', shellOut);

  let cmdState = createInitialTerminalAppState({ width: 120, height: 30 });
  cmdState = reduceTerminalAppState(cmdState, {
    type: 'overlay.open',
    kind: 'commands',
    items: [
      { id: 'session', label: 'Switch Session', description: 'restore session' },
      { id: 'model', label: 'Select Model', description: 'pick model' },
    ],
  });
  cmdState = reduceTerminalAppState(cmdState, { type: 'overlay.commandsFilter', query: 'sess' });
  const commandOut = renderTerminalFrame(cmdState, theme).buffer.toLines();
  const commandFile = writeSnapshot('commands-filter-visual', commandOut);

  let emptyState = createInitialTerminalAppState({ width: 120, height: 30 });
  emptyState = reduceTerminalAppState(emptyState, {
    type: 'overlay.open',
    kind: 'commands',
    items: [],
  });
  const emptyOut = renderTerminalFrame(emptyState, theme).buffer.toLines();
  const emptyFile = writeSnapshot('commands-empty-visual', emptyOut);

  process.stdout.write('Week3 artifacts generated:\n');
  process.stdout.write(`- ${shellFile}\n`);
  process.stdout.write(`- ${commandFile}\n`);
  process.stdout.write(`- ${emptyFile}\n`);
}

main().catch((error) => {
  process.stderr.write(`Failed to capture Week3 artifacts: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
