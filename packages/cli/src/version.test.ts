import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getXQoderVersion } from './version.js';

describe('getXQoderVersion', () => {
    it('reads the product version from package metadata', () => {
        const rootPackagePath = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '../../../package.json',
        );
        const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf-8')) as { version: string };

        expect(getXQoderVersion()).toBe(rootPackage.version);
    });
});
