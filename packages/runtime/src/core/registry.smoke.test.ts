import { describe, expect, it } from 'vitest';
import { NamedRegistry } from './registry.js';

describe('core-runtime NamedRegistry', () => {
    it('registers and retrieves items by name', () => {
        const reg = new NamedRegistry<{ name: string; id: number }>();
        reg.register({ name: 'a', id: 1 });
        reg.register({ name: 'b', id: 2 });
        expect(reg.get('a')).toEqual({ name: 'a', id: 1 });
        expect(reg.get('b')).toEqual({ name: 'b', id: 2 });
        expect(reg.get('c')).toBeUndefined();
    });

    it('list returns all registered items', () => {
        const reg = new NamedRegistry<{ name: string }>();
        reg.register({ name: 'x' });
        reg.register({ name: 'y' });
        const list = reg.list();
        expect(list).toHaveLength(2);
        expect(list.map((i) => i.name).sort()).toEqual(['x', 'y']);
    });
});
