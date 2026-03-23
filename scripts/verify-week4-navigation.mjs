#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

async function loadDeps() {
  const transcriptPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'transcript-blocks.js');
  const appStatePath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-core', 'app-state.js');
  const reducerPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-app', 'reducer.js');
  const messageJumpPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'terminal-app', 'message-jump-controller.js');

  const [{ rebuildTranscriptWithCodeBlocks }, { createInitialTerminalAppState }, { reduceTerminalAppState }, { MessageJumpController }] = await Promise.all([
    import(pathToFileURL(transcriptPath).href),
    import(pathToFileURL(appStatePath).href),
    import(pathToFileURL(reducerPath).href),
    import(pathToFileURL(messageJumpPath).href),
  ]);
  return { rebuildTranscriptWithCodeBlocks, createInitialTerminalAppState, reduceTerminalAppState, MessageJumpController };
}

async function main() {
  const { rebuildTranscriptWithCodeBlocks, createInitialTerminalAppState, reduceTerminalAppState, MessageJumpController } = await loadDeps();

  const grouped = rebuildTranscriptWithCodeBlocks([
    { id: 's:tool:read_file:1', role: 'tool', content: 'read_file /repo/src/a.ts' },
    { id: 's:tool:read_file:2', role: 'tool', content: 'read_file /repo/src/a.ts' },
    { id: 's:tool:read_file:3', role: 'tool', content: 'read_file /repo/src/b.ts' },
  ], 80);
  const groupedText = grouped.lines.join('\n');
  assert.match(groupedText, /unique sources/u, 'Expected context grouping to report unique sources');
  process.stdout.write('✓ Context group unique-source summary\n');

  const jumpEvents = [];
  const jumpState = {
    transcriptEntries: [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
    ],
    transcriptEntryLineRanges: [
      { entryId: 'u1', startLine: 1, endLine: 1 },
      { entryId: 'a1', startLine: 5, endLine: 5 },
    ],
    viewport: { anchorMessageId: 1, scrollOffset: 0, isFollowingBottom: true, selectedRange: null, viewportHeight: 2 },
    size: { width: 120, height: 20 },
    editor: { value: '', attachments: [], maxVisibleRows: 4 },
  };
  const jumpController = new MessageJumpController({
    getState: () => jumpState,
    dispatch: (event) => jumpEvents.push(event),
  });
  const handled = jumpController.handle({ type: 'key', key: 'down', ctrl: true, raw: '' });
  assert.equal(handled, true, 'Expected message jump shortcut to be handled');
  assert.deepEqual(jumpEvents[0], { type: 'viewport.focusLine.set', line: 5 });
  assert.deepEqual(jumpEvents[1], { type: 'viewport.intent.jump', targetLine: 5, anchorNumerator: 1, anchorDenominator: 3 });
  assert.match(String(jumpEvents[2]?.notice ?? ''), /Jumped to message boundary/u, 'Expected jump notice after focus update');
  process.stdout.write('✓ Message jump dispatch contract\n');

  let overlayState = createInitialTerminalAppState({ width: 120, height: 30 });
  overlayState = reduceTerminalAppState(overlayState, {
    type: 'overlay.open',
    kind: 'commands',
    items: [{ id: 'session', label: 'Session' }],
  });
  overlayState = reduceTerminalAppState(overlayState, {
    type: 'overlay.open',
    kind: 'filepicker',
    currentDir: '/tmp',
    items: [{ path: '/tmp/a.ts', label: 'a.ts', isDir: false }],
  });
  assert.equal(overlayState.overlay?.type, 'filepicker');
  overlayState = reduceTerminalAppState(overlayState, { type: 'overlay.close' });
  assert.equal(overlayState.overlay?.type, 'commands');
  process.stdout.write('✓ Overlay stack close priority\n');
}

main().catch((error) => {
  process.stderr.write(`✗ verify:week4:navigation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
