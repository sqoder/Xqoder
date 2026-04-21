import {
    formatMvpTypeErrorDemoReport,
    runMvpTypeErrorClosedLoopDemo,
} from '../src/core/agent/mvp/demo.js';

const workspaceDir = process.argv[2];
const keepWorkspace = process.argv.includes('--keep-workspace');

const result = await runMvpTypeErrorClosedLoopDemo({
    ...(workspaceDir ? { workspaceDir } : {}),
    cleanup: !keepWorkspace,
});

console.log(formatMvpTypeErrorDemoReport(result));
