import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedVersion: string | undefined;

export function getXQoderVersion(): string {
    if (cachedVersion) {
        return cachedVersion;
    }

    cachedVersion = readPackageVersion([
        '../../../package.json',
        '../package.json',
    ]) ?? '0.1.0';

    return cachedVersion;
}

function readPackageVersion(relativePaths: string[]): string | undefined {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    for (const relativePath of relativePaths) {
        const packageJsonPath = path.resolve(currentDir, relativePath);

        try {
            const raw = fs.readFileSync(packageJsonPath, 'utf-8');
            const parsed = JSON.parse(raw) as { version?: unknown };

            if (typeof parsed.version === 'string' && parsed.version.trim()) {
                return parsed.version.trim();
            }
        } catch {
            continue;
        }
    }

    return undefined;
}
