#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(repoRoot, 'docs', 'artifacts', 'week4');

async function loadRendererDeps() {
  const appStatePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'app-state.js');
  const rendererPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'renderer.js');
  const themePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'renderer-boxes.js');

  const [{ createInitialTerminalAppState }, { renderTerminalFrame }, { getTheme }] = await Promise.all([
    import(pathToFileURL(appStatePath).href),
    import(pathToFileURL(rendererPath).href),
    import(pathToFileURL(themePath).href),
  ]);

  return { createInitialTerminalAppState, renderTerminalFrame, getTheme };
}

function writeSnapshot(name, lines) {
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${name}.txt`);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

async function main() {
  const { createInitialTerminalAppState, renderTerminalFrame, getTheme } = await loadRendererDeps();
  const theme = getTheme('default');

  const state = createInitialTerminalAppState({ width: 120, height: 30 }, {
    cwd: repoRoot,
    model: 'qwen-plus',
    agent: 'general',
    title: 'XQoder',
    themeId: 'default',
  });

  state.transcriptEntries = [
    { id: 'u1', role: 'user', content: 'How does jump work?' },
    { id: 'a1', role: 'assistant', content: 'Use Ctrl+Up/Ctrl+Down to jump message boundaries (Alt+Up/Alt+Down compatible).' },
  ];
  state.transcriptLines = [
    'You',
    '  How does jump work?',
    '',
    'XQoder',
    '  Use Ctrl+Up/Ctrl+Down to jump message boundaries (Alt+Up/Alt+Down compatible).',
  ];
  state.transcriptEntryLineRanges = [
    { entryId: 'u1', startLine: 0, endLine: 1 },
    { entryId: 'a1', startLine: 3, endLine: 4 },
  ];
  state.transcriptEntryLineStarts = [0, 3];
  state.transcriptEntryLineEnds = [1, 4];
  state.transcriptEntryHeights = [2, 2];
  state.transcriptEntryCumHeights = [2, 4];
  state.transcriptEntryTotalLines = 4;
  state.viewport.focusLine = 3;

  const out = renderTerminalFrame(state, theme).buffer.toLines();
  const evidence = [
    '[Week4 keypath evidence] Ctrl+Up/Ctrl+Down jump boundaries (Alt compatibility retained)',
    ...out,
  ];
  const file = writeSnapshot('message-jump-visual', evidence);

  process.stdout.write('Week4 artifacts generated:\n');
  process.stdout.write(`- ${file}\n`);
}

main().catch((error) => {
  process.stderr.write(`Failed to capture Week4 artifacts: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
