// P09 sub-PR 4: QueryEngine facade tests.

import { describe, expect, it } from 'bun:test';
import { QueryEngine, createQueryEngine } from '../../../src/application/chat/query-engine.js';

describe('QueryEngine', () => {
    it('createQueryEngine returns a QueryEngine instance', () => {
        expect(createQueryEngine()).toBeInstanceOf(QueryEngine);
    });

    it('exposes submitMessage and runTurn methods', () => {
        const engine = new QueryEngine();
        expect(typeof engine.submitMessage).toBe('function');
        expect(typeof engine.runTurn).toBe('function');
    });
});
