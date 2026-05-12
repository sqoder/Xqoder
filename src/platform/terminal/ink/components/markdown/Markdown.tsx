// P22a — Markdown: minimal markdown renderer using chalk-style Ink Text.
// v1: headings, bold, italic, inline code, fenced code blocks, bullet lists.
import React from 'react';
import { Box, Text } from 'ink';

export interface MarkdownProps {
    text: string;
}

interface MarkdownLine {
    type: 'heading' | 'bullet' | 'code' | 'fence-open' | 'fence-close' | 'text';
    content: string;
    level?: number;
}

function parseLine(line: string): MarkdownLine {
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
        return { type: 'heading', content: headingMatch[2]!, level: headingMatch[1]!.length };
    }
    if (/^```/.test(line)) {
        return { type: 'fence-open', content: line.slice(3).trim() };
    }
    if (/^- /.test(line) || /^\* /.test(line)) {
        return { type: 'bullet', content: line.slice(2) };
    }
    return { type: 'text', content: line };
}

function renderInline(text: string): React.ReactElement {
    // Bold: **text** or __text__
    // Italic: *text* or _text_
    // Inline code: `text`
    const parts: React.ReactElement[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
        const boldMatch = /\*\*(.+?)\*\*|__(.+?)__/.exec(remaining);
        const italicMatch = /\*(.+?)\*|_(.+?)_/.exec(remaining);
        const codeMatch = /`(.+?)`/.exec(remaining);

        const candidates = [boldMatch, italicMatch, codeMatch]
            .filter(Boolean)
            .sort((a, b) => (a!.index ?? Infinity) - (b!.index ?? Infinity));

        const first = candidates[0];
        if (!first) {
            parts.push(<Text key={key++}>{remaining}</Text>);
            break;
        }

        if (first.index > 0) {
            parts.push(<Text key={key++}>{remaining.slice(0, first.index)}</Text>);
        }

        const matched = first[0];
        const inner = first[1] ?? first[2] ?? '';

        if (first === boldMatch) {
            parts.push(<Text key={key++} bold>{inner}</Text>);
        } else if (first === italicMatch) {
            parts.push(<Text key={key++} italic>{inner}</Text>);
        } else {
            parts.push(<Text key={key++} color="yellow">{`\`${inner}\``}</Text>);
        }

        remaining = remaining.slice(first.index + matched.length);
    }

    return <>{parts}</>;
}

export function Markdown({ text }: MarkdownProps): React.ReactElement {
    const lines = text.split('\n');
    const elements: React.ReactElement[] = [];
    let inFence = false;
    let fenceLines: string[] = [];
    let fenceLang = '';
    let key = 0;

    for (const raw of lines) {
        if (inFence) {
            if (/^```/.test(raw)) {
                elements.push(
                    <Box key={key++} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginY={0}>
                        {fenceLines.map((l, i) => (
                            <Text key={i} color="yellow">{l}</Text>
                        ))}
                    </Box>,
                );
                fenceLines = [];
                fenceLang = '';
                inFence = false;
            } else {
                fenceLines.push(raw);
            }
            continue;
        }

        const parsed = parseLine(raw);

        if (parsed.type === 'fence-open') {
            inFence = true;
            fenceLang = parsed.content;
            void fenceLang; // used for future language-aware highlighting
            continue;
        }

        if (parsed.type === 'heading') {
            const colors: Record<number, string> = { 1: 'magenta', 2: 'blue', 3: 'cyan' };
            const color = colors[parsed.level ?? 1] ?? 'white';
            elements.push(
                <Box key={key++} marginTop={parsed.level === 1 ? 1 : 0}>
                    <Text bold color={color as 'magenta' | 'blue' | 'cyan' | 'white'}>
                        {'#'.repeat(parsed.level ?? 1)} {parsed.content}
                    </Text>
                </Box>,
            );
            continue;
        }

        if (parsed.type === 'bullet') {
            elements.push(
                <Box key={key++}>
                    <Text color="green">{'  • '}</Text>
                    {renderInline(parsed.content)}
                </Box>,
            );
            continue;
        }

        if (raw.trim() === '') {
            elements.push(<Box key={key++} marginY={0}><Text>{' '}</Text></Box>);
            continue;
        }

        elements.push(
            <Box key={key++}>
                {renderInline(parsed.content)}
            </Box>,
        );
    }

    return <Box flexDirection="column">{elements}</Box>;
}
