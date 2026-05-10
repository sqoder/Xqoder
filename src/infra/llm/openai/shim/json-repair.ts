// Repairs a JSON fragment that was produced token-by-token and got truncated
// at any depth by closing open objects / arrays / strings in stack order.
// Only guarantees syntactic completion; the resulting JSON may still be
// semantically partial (e.g. `{"a":` -> `{"a":""}`).

type OpenFrame = '{' | '[' | '"';

export function repairPossiblyTruncatedObjectJson(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return trimmed;

    const stack: OpenFrame[] = [];
    let escaped = false;

    for (const ch of trimmed) {
        const top = stack[stack.length - 1];
        if (top === '"') {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                stack.pop();
            }
            continue;
        }
        if (ch === '"') {
            stack.push('"');
            continue;
        }
        if (ch === '{') stack.push('{');
        else if (ch === '[') stack.push('[');
        else if (ch === '}' && top === '{') stack.pop();
        else if (ch === ']' && top === '[') stack.pop();
    }

    let closed = trimmed;
    if (escaped) {
        // dangling backslash inside an open string — drop it
        closed = closed.slice(0, -1);
    }

    // Dangling `,` or `:` makes JSON.parse throw even after closing.
    // Trim those before appending closers so `{"a":` becomes `{"a":""}` etc.
    const danglingColon = /:\s*$/;
    const danglingComma = /,\s*$/;

    while (danglingComma.test(closed)) {
        closed = closed.replace(danglingComma, '');
    }
    if (danglingColon.test(closed)) {
        closed = closed.replace(danglingColon, ':""');
    }

    for (let i = stack.length - 1; i >= 0; i--) {
        const frame = stack[i];
        closed += frame === '{' ? '}' : frame === '[' ? ']' : '"';
    }

    return closed;
}
