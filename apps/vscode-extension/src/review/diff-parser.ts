/**
 * Unified-diff parser for XQoder approval previews.
 *
 * The XQoder backend emits previews in the style of `git diff --no-index`.
 * Given such a preview plus the current on-disk content we reconstruct the
 * proposed "after" content so a native `vscode.diff` editor can render the
 * exact same change as the preview. Returns `undefined` if the preview is
 * not a well-formed unified diff — callers fall back to the legacy
 * text-preview behaviour in that case.
 */

export interface ParsedDiffPreview {
    /** The file path extracted from the diff headers (repo-relative). */
    filePath: string;
    /** Whether the diff creates a new file. */
    isNewFile: boolean;
    /** Parsed hunks, ready for application against the on-disk content. */
    hunks: DiffHunk[];
}

export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
}

export function parseDiffPreview(preview: string): ParsedDiffPreview | undefined {
    if (!preview || typeof preview !== 'string') {
        return undefined;
    }

    const normalized = preview.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    const filePath = extractFilePath(lines);
    if (!filePath) {
        return undefined;
    }

    const isNewFile = lines.some((line) => line.startsWith('new file mode'))
        || lines.some((line) => line === '--- /dev/null');

    const hunks = collectHunks(lines);
    if (hunks.length === 0) {
        return undefined;
    }

    return {
        filePath,
        isNewFile,
        hunks,
    };
}

/**
 * Apply a parsed diff against the current on-disk content and return the
 * proposed after-content. For new files the hunk content is the entire
 * result.
 *
 * Returns `undefined` if the hunks cannot be applied cleanly (context lines
 * don't match the current file at the expected positions). The caller can
 * fall back to the text preview in that case.
 */
export function applyDiffToContent(
    parsed: ParsedDiffPreview,
    currentContent: string | undefined,
): string | undefined {
    if (parsed.isNewFile || currentContent === undefined) {
        return reconstructNewFileContent(parsed);
    }

    const currentLines = currentContent.split('\n');
    const output: string[] = [];
    let cursor = 0; // 0-indexed position into currentLines

    for (const hunk of parsed.hunks) {
        // oldStart is 1-indexed, 0 when the hunk appends to an empty file.
        const targetIndex = Math.max(hunk.oldStart - 1, 0);
        if (targetIndex < cursor) {
            // Overlapping hunks — bail out.
            return undefined;
        }

        // Copy unchanged lines between previous cursor and this hunk's start.
        for (let i = cursor; i < targetIndex && i < currentLines.length; i += 1) {
            output.push(currentLines[i]!);
        }
        cursor = targetIndex;

        for (const raw of hunk.lines) {
            if (raw.startsWith('\\')) {
                continue;
            }
            const body = raw.slice(1);
            if (raw.startsWith(' ')) {
                if (currentLines[cursor] !== body) {
                    // Context mismatch — abort; caller falls back.
                    return undefined;
                }
                output.push(body);
                cursor += 1;
            } else if (raw.startsWith('-')) {
                if (currentLines[cursor] !== body) {
                    return undefined;
                }
                cursor += 1;
            } else if (raw.startsWith('+')) {
                output.push(body);
            }
        }
    }

    // Append any remaining lines after the last hunk.
    for (let i = cursor; i < currentLines.length; i += 1) {
        output.push(currentLines[i]!);
    }

    return output.join('\n');
}

function reconstructNewFileContent(parsed: ParsedDiffPreview): string {
    const lines: string[] = [];
    for (const hunk of parsed.hunks) {
        for (const raw of hunk.lines) {
            if (raw.startsWith('\\')) {
                continue;
            }
            const body = raw.slice(1);
            if (raw.startsWith('+') || raw.startsWith(' ')) {
                lines.push(body);
            }
        }
    }
    return lines.join('\n');
}

function extractFilePath(lines: string[]): string | undefined {
    for (const line of lines) {
        const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
        if (match) {
            return match[2];
        }
    }

    // Fallback: `+++ b/path` or `+++ path` (plain).
    for (const line of lines) {
        if (!line.startsWith('+++ ')) {
            continue;
        }
        const rest = line.slice(4).trim();
        if (rest === '/dev/null') {
            continue;
        }
        if (rest.startsWith('b/')) {
            return rest.slice(2);
        }
        if (rest.length > 0) {
            return rest;
        }
    }

    return undefined;
}

function collectHunks(lines: string[]): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    let current: DiffHunk | undefined;

    for (const line of lines) {
        const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (hunkHeader) {
            if (current) {
                hunks.push(current);
            }
            current = {
                oldStart: Number(hunkHeader[1]),
                oldLines: hunkHeader[2] !== undefined ? Number(hunkHeader[2]) : 1,
                newStart: Number(hunkHeader[3]),
                newLines: hunkHeader[4] !== undefined ? Number(hunkHeader[4]) : 1,
                lines: [],
            };
            continue;
        }

        if (!current) {
            continue;
        }

        if (
            line.startsWith(' ')
            || line.startsWith('+')
            || line.startsWith('-')
            || line.startsWith('\\')
        ) {
            current.lines.push(line);
            continue;
        }

        hunks.push(current);
        current = undefined;
    }

    if (current) {
        hunks.push(current);
    }

    return hunks;
}
