import type { EditorModel } from './editor-model.js';
import { countGraphemes } from './editor-model.js';

export type EditorInputPart =
    | { kind: 'text'; content: string }
    | { kind: 'file_pill'; display: string }
    | { kind: 'pasted_pill'; wordCount: number }
    | { kind: 'image_pill'; index: number };

export interface EditorInputPartModel {
    parts: EditorInputPart[];
    cursorPartOffset: number;
    totalPartGraphemes: number;
    inputMode: 'build' | 'plan' | 'shell';
}

function resolveWordCount(label: string): number {
    const matched = label.match(/(\d+)/);
    return matched ? Number.parseInt(matched[1]!, 10) : 0;
}

export function buildEditorInputPartModel(
    editor: EditorModel,
    interactionMode: 'build' | 'plan',
): EditorInputPartModel {
    const parts: EditorInputPart[] = [];
    let imageIndex = 1;
    for (const attachment of editor.attachments) {
        if (attachment.kind === 'image') {
            parts.push({ kind: 'image_pill', index: imageIndex });
            imageIndex += 1;
            continue;
        }
        if (attachment.kind === 'text') {
            parts.push({ kind: 'pasted_pill', wordCount: resolveWordCount(attachment.label) });
            continue;
        }
        parts.push({ kind: 'file_pill', display: attachment.label });
    }

    // 输入框占位符由 Rust renderer 负责绘制，前端服务层只提供“真实输入值”。
    // 这样避免把 placeholder 当成文本参与渲染，导致 “ni a hoType a message...” 这类残留拼接。
    const editorText = editor.value;
    parts.push({ kind: 'text', content: editorText });

    const fallbackCursor = editor.attachments.length + countGraphemes(editor.value.slice(0, editor.cursorOffset));
    const totalPartGraphemes = editor.attachments.length + countGraphemes(editor.value);
    const cursorPartOffset = Math.max(0, Math.min(totalPartGraphemes, editor.cursorPartOffset ?? fallbackCursor));
    const inputMode = editor.value.trimStart().startsWith('!') ? 'shell' : interactionMode;

    return {
        parts,
        cursorPartOffset,
        totalPartGraphemes,
        inputMode,
    };
}
