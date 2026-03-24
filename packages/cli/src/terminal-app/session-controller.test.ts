import { describe, expect, it, vi } from 'vitest';
import { SessionController } from './session-controller.js';

describe('SessionController', () => {
    it('supports async local session listing when opening the overlay', async () => {
        const dispatch = vi.fn();
        const renderNow = vi.fn(async () => undefined);
        const listLocalSessions = vi.fn(async () => ([
            { id: 'session_async', title: 'Async Session' },
        ]));

        const controller = new SessionController({
            dispatch,
            renderNow,
            listLocalSessions,
            listRemoteSessions: vi.fn(async () => []),
            createRemoteSession: vi.fn(async () => ({ id: 'remote', title: 'Remote' })),
            setActiveSessionId: vi.fn(),
        });

        controller.openSessionOverlay('/repo');
        await new Promise((resolve) => setTimeout(resolve, 0));
        await Promise.resolve();

        expect(listLocalSessions).toHaveBeenCalledWith('/repo', 20);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'overlay.open',
            kind: 'session',
            items: [{ id: 'session_async', title: 'Async Session' }],
        });
    });
});
