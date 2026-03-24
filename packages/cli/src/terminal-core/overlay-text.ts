export function getCommandsEmptyStateText(query: string): string {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
        return 'No commands available';
    }
    return `No commands match "/${trimmed}"`;
}
