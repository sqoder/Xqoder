// Violates the absolute-import rule in CLAUDE.md: uses ../ relative import
import { bar } from '../lib/bar';

export function foo(): string {
    return bar();
}
