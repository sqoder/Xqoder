export function sanitizeProjectName(name: string, fallback = 'xqoder-project'): string {
    const sanitized = name
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/[-._]{2,}/g, '-')
        .replace(/^[-._]+|[-._]+$/g, '')
        .slice(0, 100);

    return sanitized || fallback;
}
