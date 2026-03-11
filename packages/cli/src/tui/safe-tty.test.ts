import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { installSafeTtyGuards, isIgnorableTtyStreamError } from './safe-tty.js';

function createStreamMock() {
    const stream = new EventEmitter() as EventEmitter & {
        writable: boolean;
        write: (...args: unknown[]) => boolean;
    };

    stream.writable = true;
    stream.write = () => true;

    return stream;
}

describe('safe tty guards', () => {
    it('recognizes tty disconnect errors that should not crash Ink', () => {
        expect(isIgnorableTtyStreamError(Object.assign(new Error('write EIO'), { code: 'EIO' }))).toBe(true);
        expect(isIgnorableTtyStreamError(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))).toBe(true);
        expect(isIgnorableTtyStreamError(new Error('stream destroyed'))).toBe(true);
        expect(isIgnorableTtyStreamError(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))).toBe(false);
    });

    it('swallows ignorable error events from stdin-like streams', () => {
        const stdin = createStreamMock();
        const stdout = createStreamMock();
        const stderr = createStreamMock();
        const restore = installSafeTtyGuards({ stdin, stdout, stderr });

        expect(() => stdin.emit('error', Object.assign(new Error('read EIO'), { code: 'EIO' }))).not.toThrow();

        restore();
    });

    it('swallows synchronous stdout write EIO errors and restores original behavior', () => {
        const stdin = createStreamMock();
        const stdout = createStreamMock();
        const stderr = createStreamMock();
        const error = Object.assign(new Error('write EIO'), { code: 'EIO' });

        stdout.write = () => {
            throw error;
        };

        const restore = installSafeTtyGuards({ stdin, stdout, stderr });

        expect(() => stdout.write('render frame')).not.toThrow();

        restore();

        expect(() => stdout.write('render frame')).toThrow(error);
    });
});
