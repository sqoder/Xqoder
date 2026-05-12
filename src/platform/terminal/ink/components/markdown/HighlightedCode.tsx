// P22a — HighlightedCode: syntax-highlighted code block (keyword-based, no deps).
import React from 'react';
import { Box, Text } from 'ink';

export interface HighlightedCodeProps {
    code: string;
    language?: string;
}

const KEYWORDS: Record<string, string[]> = {
    ts: ['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'export', 'import', 'from', 'return', 'if', 'else', 'for', 'while', 'async', 'await', 'new', 'extends', 'implements', 'readonly', 'public', 'private', 'protected', 'static', 'void', 'null', 'undefined', 'true', 'false'],
    js: ['const', 'let', 'var', 'function', 'class', 'export', 'import', 'from', 'return', 'if', 'else', 'for', 'while', 'async', 'await', 'new', 'null', 'undefined', 'true', 'false'],
    py: ['def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else', 'for', 'while', 'async', 'await', 'with', 'as', 'None', 'True', 'False', 'and', 'or', 'not', 'in', 'is', 'lambda', 'yield'],
};

function getKeywords(lang: string): Set<string> {
    const normalized = lang.toLowerCase().replace(/^typescript$/, 'ts').replace(/^javascript$/, 'js').replace(/^python$/, 'py');
    return new Set(KEYWORDS[normalized] ?? KEYWORDS['ts']!);
}

function tokenizeLine(line: string, keywords: Set<string>): React.ReactElement {
    const tokens: React.ReactElement[] = [];
    let remaining = line;
    let key = 0;

    while (remaining.length > 0) {
        // String literals
        const strMatch = /^(['"`])(?:[^\\]|\\.)*?\1/.exec(remaining);
        if (strMatch) {
            tokens.push(<Text key={key++} color="green">{strMatch[0]}</Text>);
            remaining = remaining.slice(strMatch[0].length);
            continue;
        }

        // Comments
        if (remaining.startsWith('//') || remaining.startsWith('#')) {
            tokens.push(<Text key={key++} dimColor>{remaining}</Text>);
            break;
        }

        // Numbers
        const numMatch = /^\b\d+(\.\d+)?\b/.exec(remaining);
        if (numMatch) {
            tokens.push(<Text key={key++} color="yellow">{numMatch[0]}</Text>);
            remaining = remaining.slice(numMatch[0].length);
            continue;
        }

        // Words (keywords or identifiers)
        const wordMatch = /^[a-zA-Z_$][a-zA-Z0-9_$]*/.exec(remaining);
        if (wordMatch) {
            const word = wordMatch[0];
            if (keywords.has(word)) {
                tokens.push(<Text key={key++} color="blue">{word}</Text>);
            } else {
                tokens.push(<Text key={key++}>{word}</Text>);
            }
            remaining = remaining.slice(word.length);
            continue;
        }

        // Punctuation / operators
        tokens.push(<Text key={key++} color="cyan">{remaining[0]}</Text>);
        remaining = remaining.slice(1);
    }

    return <>{tokens}</>;
}

export function HighlightedCode({ code, language = 'ts' }: HighlightedCodeProps): React.ReactElement {
    const keywords = getKeywords(language);
    const lines = code.split('\n');

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
            {language && <Text dimColor>{language}</Text>}
            {lines.map((line, i) => (
                <Box key={i}>
                    <Text dimColor>{String(i + 1).padStart(3, ' ')} </Text>
                    {tokenizeLine(line, keywords)}
                </Box>
            ))}
        </Box>
    );
}
