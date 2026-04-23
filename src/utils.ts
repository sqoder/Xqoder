export interface DemoUser {
    id?: string;
}

export function getPrimaryUserId(currentUser?: DemoUser): string {
    const id = currentUser?.id;

    if (typeof id !== 'string' || id.trim().length === 0) {
        return 'UNKNOWN';
    }

    return id.toUpperCase();
}
