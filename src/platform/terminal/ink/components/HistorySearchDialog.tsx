// P23b — HistorySearchDialog: fuzzy history search with minimum edit distance.
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

// ---------------------------------------------------------------------------
// Fuzzy match: minimum edit distance (Levenshtein), capped for performance
// ---------------------------------------------------------------------------

function editDistance(a: string, b: string): number {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    const m = al.length;
    const n = bl.length;
    if (m === 0) return n;
    if (n === 0) return m;

    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (al[i - 1] === bl[j - 1]) {
                dp[i]![j] = dp[i - 1]![j - 1]!;
            } else {
                dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
            }
        }
    }
    return dp[m]![n]!;
}

export function fuzzyScore(query: string, item: string): number {
    if (!query) return 0;
    const q = query.toLowerCase();
    const s = item.toLowerCase();

    // Exact substring match scores highest
    if (s.includes(q)) return 1000 - s.indexOf(q);

    // Prefix match
    if (s.startsWith(q)) return 900;

    // Edit distance (lower = better, invert for scoring)
    const dist = editDistance(q, s.slice(0, Math.min(s.length, q.length * 2)));
    return Math.max(0, 100 - dist * 10);
}

export function searchHistory(query: string, items: string[], limit = 10): string[] {
    if (!query.trim()) return items.slice(-limit).reverse();

    return items
        .map((item) => ({ item, score: fuzzyScore(query, item) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ item }) => item);
}

// ---------------------------------------------------------------------------
// HistorySearchDialog component
// ---------------------------------------------------------------------------

export interface HistorySearchDialogProps {
    items: string[];
    onSelect: (text: string) => void;
    onCancel: () => void;
}

export function HistorySearchDialog({ items, onSelect, onCancel }: HistorySearchDialogProps): React.ReactElement {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);

    const results = searchHistory(query, items);

    useInput((input, key) => {
        if (key.escape) {
            onCancel();
            return;
        }

        if (key.return) {
            const selected = results[selectedIndex];
            if (selected) onSelect(selected);
            else onCancel();
            return;
        }

        if (key.upArrow) {
            setSelectedIndex((i) => Math.max(0, i - 1));
            return;
        }

        if (key.downArrow) {
            setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
            return;
        }

        if (key.backspace || key.delete) {
            setQuery((q) => q.slice(0, -1));
            setSelectedIndex(0);
            return;
        }

        if (!key.ctrl && !key.meta && input) {
            setQuery((q) => q + input);
            setSelectedIndex(0);
        }
    });

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
            <Box>
                <Text bold color="cyan">History Search </Text>
                <Text dimColor>(↑↓ navigate, Enter select, Esc cancel)</Text>
            </Box>
            <Box>
                <Text color="cyan">{'> '}</Text>
                <Text>{query}</Text>
                <Text inverse>{' '}</Text>
            </Box>
            <Box flexDirection="column" marginTop={1}>
                {results.length === 0 ? (
                    <Text dimColor>No matches</Text>
                ) : (
                    results.map((item, i) => (
                        <Box key={i}>
                            <Text color={i === selectedIndex ? 'cyan' : undefined} inverse={i === selectedIndex}>
                                {i === selectedIndex ? '▶ ' : '  '}
                                {item.slice(0, 60)}{item.length > 60 ? '…' : ''}
                            </Text>
                        </Box>
                    ))
                )}
            </Box>
        </Box>
    );
}
