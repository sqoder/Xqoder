// P23a — matchKeys: maps Ink key events to keybinding key strings.

export interface InkKeyEvent {
    ctrl?: boolean;
    shift?: boolean;
    meta?: boolean;
    return?: boolean;
    escape?: boolean;
    backspace?: boolean;
    delete?: boolean;
    tab?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    pageUp?: boolean;
    pageDown?: boolean;
    name?: string;
    sequence?: string;
}

/**
 * Convert an Ink key event + input character to a normalized key string.
 * Examples: 'ctrl+c', 'shift+tab', 'escape', 'return', 'up'
 */
export function matchKeys(input: string, key: InkKeyEvent): string[] {
    const parts: string[] = [];

    if (key.ctrl) parts.push('ctrl');
    if (key.shift) parts.push('shift');
    if (key.meta) parts.push('meta');

    if (key.return) { parts.push('return'); return [parts.join('+')]; }
    if (key.escape) { parts.push('escape'); return [parts.join('+')]; }
    if (key.backspace) { parts.push('backspace'); return [parts.join('+')]; }
    if (key.delete) { parts.push('delete'); return [parts.join('+')]; }
    if (key.tab) { parts.push('tab'); return [parts.join('+')]; }
    if (key.upArrow) { parts.push('up'); return [parts.join('+')]; }
    if (key.downArrow) { parts.push('down'); return [parts.join('+')]; }
    if (key.leftArrow) { parts.push('left'); return [parts.join('+')]; }
    if (key.rightArrow) { parts.push('right'); return [parts.join('+')]; }
    if (key.pageUp) { parts.push('pageup'); return [parts.join('+')]; }
    if (key.pageDown) { parts.push('pagedown'); return [parts.join('+')]; }

    if (input) {
        parts.push(input.toLowerCase());
        return [parts.join('+')];
    }

    if (key.name) {
        parts.push(key.name.toLowerCase());
        return [parts.join('+')];
    }

    if (key.sequence) {
        parts.push(key.sequence);
        return [parts.join('+')];
    }

    return [];
}

/**
 * Check if a key event matches any of the given key combos.
 */
export function keysMatch(input: string, key: InkKeyEvent, combos: string[]): boolean {
    const matched = matchKeys(input, key);
    return matched.some((k) => combos.includes(k));
}
