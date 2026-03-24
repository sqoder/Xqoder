interface AutocompleteResult {
    trigger: '@' | '/';
    query: string;
}

export type AutocompleteOverlayIntent = 'open-complete' | 'open-commands' | null;

export function resolveAutocompleteOverlayIntent(inputText: string, before: string, result: AutocompleteResult | null): AutocompleteOverlayIntent {
    if (inputText === '@' && result?.trigger === '@') {
        return 'open-complete';
    }
    if (inputText === '/' && result?.trigger === '/' && before.trim().length === 0) {
        return 'open-commands';
    }
    return null;
}

export class AutocompleteController {
    private trigger: '@' | '/' | null = null;
    private query = '';

    update(text: string, cursor: number): AutocompleteResult | null {
        const before = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
        const atIdx = before.lastIndexOf('@');
        const slashIdx = before.lastIndexOf('/');

        if (atIdx >= 0) {
            const q = before.slice(atIdx + 1);
            if (!q.includes(' ')) {
                this.trigger = '@';
                this.query = q;
                return { trigger: '@', query: q };
            }
        }

        if (slashIdx >= 0) {
            const q = before.slice(slashIdx + 1);
            if (!q.includes(' ')) {
                this.trigger = '/';
                this.query = q;
                return { trigger: '/', query: q };
            }
        }

        this.trigger = null;
        this.query = '';
        return null;
    }

    reset(): void {
        this.trigger = null;
        this.query = '';
    }

    getState(): { trigger: '@' | '/' | null; query: string } {
        return { trigger: this.trigger, query: this.query };
    }
}
