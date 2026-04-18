import { createXQoderEntrypoints } from './compose.js';

export async function runCliMain(argv: string[] = process.argv): Promise<void> {
    const entrypoints = createXQoderEntrypoints();
    await entrypoints.runCli(argv);
}
