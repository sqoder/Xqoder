import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export function createAnalysisTempPrefix(fileName: string): string {
    const safeName = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 48) || 'file';
    return path.join(os.tmpdir(), `xqoder-${process.pid}-${Date.now()}-${safeName}`);
}

export async function createAnalysisTempDir(fileName: string): Promise<string> {
    return fs.mkdtemp(`${createAnalysisTempPrefix(fileName)}-`);
}
