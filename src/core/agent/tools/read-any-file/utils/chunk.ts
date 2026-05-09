export interface TruncatedText {
    text: string;
    truncated: boolean;
}

export function normalizeExtractedText(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
}

export function truncateTextByChars(value: string, maxChars: number): TruncatedText {
    if (value.length <= maxChars) {
        return { text: value, truncated: false };
    }

    const headChars = Math.floor(maxChars * 0.6);
    const tailChars = Math.max(0, maxChars - headChars);
    return {
        text: [
            value.slice(0, headChars),
            `\n\n[... truncated ${value.length - maxChars} chars ...]\n\n`,
            value.slice(value.length - tailChars),
        ].join(''),
        truncated: true,
    };
}
