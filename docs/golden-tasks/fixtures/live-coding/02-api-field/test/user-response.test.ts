import { describe, expect, test } from 'bun:test';
import { buildUserResponse, type UserV2 } from '../src/user-response';

describe('buildUserResponse', () => {
    test('includes the new displayName field derived from first + last', () => {
        const user: UserV2 = {
            id: 'u-1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
        };

        const response = buildUserResponse(user);

        expect(response.id).toBe('u-1');
        expect(response.email).toBe('ada@example.com');
        expect(response.displayName).toBe('Ada Lovelace');
    });

    test('is backward compatible when lastName is missing', () => {
        const user: UserV2 = {
            id: 'u-2',
            firstName: 'Grace',
            email: 'grace@example.com',
        };

        const response = buildUserResponse(user);

        expect(response.displayName).toBe('Grace');
    });
});
