// P23a — KeybindingContext: React context for keybinding resolution.
import React, { createContext, useContext, useMemo } from 'react';
import type { Keybinding } from './defaults.js';
import { DEFAULT_KEYBINDINGS } from './defaults.js';
import { keysMatch, type InkKeyEvent } from './match.js';

export interface KeybindingContextValue {
    bindings: Keybinding[];
    resolve: (input: string, key: InkKeyEvent) => string | undefined;
}

const KeybindingContext = createContext<KeybindingContextValue>({
    bindings: DEFAULT_KEYBINDINGS,
    resolve: (input, key) => {
        for (const b of DEFAULT_KEYBINDINGS) {
            if (keysMatch(input, key, b.keys)) return b.command;
        }
        return undefined;
    },
});

export interface KeybindingProviderProps {
    bindings?: Keybinding[];
    children: React.ReactNode;
}

export function KeybindingProvider({ bindings = DEFAULT_KEYBINDINGS, children }: KeybindingProviderProps): React.ReactElement {
    const value = useMemo<KeybindingContextValue>(() => ({
        bindings,
        resolve: (input, key) => {
            for (const b of bindings) {
                if (keysMatch(input, key, b.keys)) return b.command;
            }
            return undefined;
        },
    }), [bindings]);

    return (
        <KeybindingContext.Provider value={value}>
            {children}
        </KeybindingContext.Provider>
    );
}

export function useKeybindings(): KeybindingContextValue {
    return useContext(KeybindingContext);
}
