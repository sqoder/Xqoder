import * as path from 'node:path';
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import {
    FileRollbackStore,
    LspCompletionTool,
    LspHoverTool,
    LspRenameSymbolTool,
    createDefaultLspTools,
    type ToolApprovalRequest,
    type ToolContext,
} from '@xqoder/agent';
import { Command } from 'commander';
import {
    configManager,
    getXQoderPaths,
    logger,
    resolveConfigWithEnvOverrides,
    type LSPServerConfig,
} from '@xqoder/shared';
import { ImeTextInput } from '../tui/ime-text-input.js';

type LspUiMode = 'hover' | 'completion' | 'rename';

export interface LspUiCommandOptions {
    dir?: string;
    file: string;
    mode?: LspUiMode;
}

interface PendingRenameApproval {
    request: ToolApprovalRequest;
    args: Record<string, unknown>;
}

interface XQoderLspUiProps {
    projectRoot: string;
    filePath: string;
    initialMode: LspUiMode;
    lspServers: LSPServerConfig[];
}

export async function runLspUiCommand(options: LspUiCommandOptions): Promise<void> {
    const { config } = resolveConfigWithEnvOverrides(configManager.load());
    const projectRoot = path.resolve(options.dir ?? process.cwd());
    const filePath = path.resolve(projectRoot, options.file);

    if (process.stdout.isTTY) {
        console.clear();
    }

    const instance = render(
        React.createElement(XQoderLspUi, {
            projectRoot,
            filePath,
            initialMode: options.mode ?? 'hover',
            lspServers: config.lsp?.servers ?? [],
        }),
        {
            exitOnCtrlC: false,
        },
    );

    await instance.waitUntilExit();
}

export function createLspUiCommand(): Command {
    return new Command('ui')
        .description('启动独立 LSP TUI，用于 hover / completion / rename')
        .requiredOption('-f, --file <path>', '要分析的目标文件（相对项目目录或绝对路径）')
        .option('-d, --dir <dir>', '项目目录，默认当前目录')
        .option('-m, --mode <mode>', '初始模式 (hover/completion/rename)', 'hover')
        .action(async (options: LspUiCommandOptions) => {
            try {
                await runLspUiCommand(options);
            } catch (error) {
                logger.error(`LSP UI 启动失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });
}

export function parseLspUiSubmission(
    mode: LspUiMode,
    input: string,
): {
    line: number;
    character: number;
    newName?: string;
} {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error('请输入位置参数');
    }

    const [positionPart, ...rest] = trimmed.split(/\s+/);
    const match = positionPart.match(/^(\d+):(\d+)$/);
    if (!match) {
        throw new Error('位置格式应为 line:character，例如 4:11');
    }

    const line = Number.parseInt(match[1] ?? '', 10);
    const character = Number.parseInt(match[2] ?? '', 10);
    if (!Number.isFinite(line) || line <= 0 || !Number.isFinite(character) || character <= 0) {
        throw new Error('line:character 必须是正整数');
    }

    if (mode !== 'rename') {
        return { line, character };
    }

    const newName = rest.join(' ').trim();
    if (!newName) {
        throw new Error('rename 模式需要新的符号名，例如 4:11 welcomeUser');
    }

    return {
        line,
        character,
        newName,
    };
}

export function getLspUiPlaceholder(mode: LspUiMode): string {
    switch (mode) {
        case 'completion':
            return '例如 4:11，返回补全候选并自动 resolve 前几个条目';
        case 'rename':
            return '例如 4:11 welcomeUser';
        case 'hover':
        default:
            return '例如 4:11';
    }
}

function XQoderLspUi({
    projectRoot,
    filePath,
    initialMode,
    lspServers,
}: XQoderLspUiProps): React.JSX.Element {
    const { exit } = useApp();
    const [mode, setMode] = useState<LspUiMode>(initialMode);
    const [inputValue, setInputValue] = useState('');
    const [result, setResult] = useState('准备就绪。输入位置后回车执行。');
    const [busy, setBusy] = useState(false);
    const [pendingRename, setPendingRename] = useState<PendingRenameApproval | undefined>(undefined);
    const rollbackStore = useMemo(
        () => new FileRollbackStore(getXQoderPaths().rollbackDir),
        [],
    );
    const lspTools = useMemo(
        () => createDefaultLspTools({
            lspServers,
            cwd: projectRoot,
            projectRoot,
        }),
        [lspServers, projectRoot],
    );
    const hoverTool = useMemo(() => new LspHoverTool(lspTools.externalManager), [lspTools.externalManager]);
    const completionTool = useMemo(() => new LspCompletionTool(lspTools.externalManager), [lspTools.externalManager]);
    const renameTool = useMemo(() => new LspRenameSymbolTool(lspTools.externalManager), [lspTools.externalManager]);
    const context = useMemo<ToolContext>(() => ({
        cwd: projectRoot,
        projectRoot,
        rollbackStore,
    }), [projectRoot, rollbackStore]);

    useEffect(() => () => {
        void lspTools.externalManager?.dispose();
    }, [lspTools.externalManager]);

    useInput((input, key) => {
        if (input === 'c' && key.ctrl) {
            exit();
            return;
        }

        if (busy) {
            return;
        }

        if (pendingRename) {
            if (input.toLowerCase() === 'y') {
                void confirmRename();
                return;
            }
            if (input.toLowerCase() === 'n' || key.escape) {
                setPendingRename(undefined);
                setResult('已取消 rename。');
            }
            return;
        }

        if (key.tab || key.rightArrow) {
            setMode((current) => nextMode(current));
            setInputValue('');
            return;
        }

        if (key.leftArrow) {
            setMode((current) => previousMode(current));
            setInputValue('');
        }
    });

    return (
        <Box flexDirection="column" paddingX={1}>
            <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
                <Text color="cyan" bold>XQoder LSP UI</Text>
                <Text dimColor>{`Project: ${projectRoot}`}</Text>
                <Text dimColor>{`File: ${filePath}`}</Text>
            </Box>

            <Box marginTop={1}>
                {(['hover', 'completion', 'rename'] as LspUiMode[]).map((entry, index) => (
                    <Box key={entry} marginRight={index < 2 ? 2 : 0}>
                        <Text color={entry === mode ? '#4F84FF' : 'gray'} bold={entry === mode}>
                            {entry}
                        </Text>
                    </Box>
                ))}
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text dimColor>Tab/左右箭头切模式，Enter 执行，Ctrl+C 退出。</Text>
                {pendingRename
                    ? <Text color="yellow">Y 确认 rename，N 或 Esc 取消。</Text>
                    : <Text dimColor>rename 会先显示 diff preview，再确认执行。</Text>}
            </Box>

            <Box marginTop={1} borderStyle="round" borderColor={pendingRename ? 'yellow' : 'gray'} paddingX={1} flexDirection="column">
                {pendingRename ? (
                    <>
                        <Text bold>{pendingRename.request.summary}</Text>
                        {pendingRename.request.reason ? <Text dimColor>{pendingRename.request.reason}</Text> : null}
                        <Box marginTop={1}>
                            <Text>{pendingRename.request.preview ?? '无 diff 预览'}</Text>
                        </Box>
                    </>
                ) : (
                    <>
                        <Text>{`Mode: ${mode}`}</Text>
                        <ImeTextInput
                            value={inputValue}
                            onChange={setInputValue}
                            onSubmit={(value) => {
                                void handleSubmit(value);
                            }}
                            placeholder={getLspUiPlaceholder(mode)}
                            showCursor
                        />
                    </>
                )}
            </Box>

            <Box marginTop={1} borderStyle="round" borderColor={busy ? 'yellow' : 'green'} paddingX={1} flexDirection="column">
                <Text bold>{busy ? 'Running' : 'Result'}</Text>
                {result.split('\n').map((line, index) => (
                    <Text key={`${index}-${line}`}>{line}</Text>
                ))}
            </Box>
        </Box>
    );

    async function handleSubmit(value: string): Promise<void> {
        try {
            const parsed = parseLspUiSubmission(mode, value);
            setBusy(true);
            if (mode === 'hover') {
                const hoverResult = await hoverTool.execute({
                    path: filePath,
                    line: parsed.line,
                    character: parsed.character,
                    toolCallId: 'lsp-ui-hover',
                }, context);
                setResult(hoverResult.error ?? hoverResult.output);
                setInputValue('');
                return;
            }

            if (mode === 'completion') {
                const completionResult = await completionTool.execute({
                    path: filePath,
                    line: parsed.line,
                    character: parsed.character,
                    limit: 8,
                    resolveDetails: true,
                    resolveLimit: 3,
                    toolCallId: 'lsp-ui-completion',
                }, context);
                setResult(completionResult.error ?? completionResult.output);
                setInputValue('');
                return;
            }

            const renameArgs = {
                path: filePath,
                line: parsed.line,
                character: parsed.character,
                newName: parsed.newName!,
            };
            const request = await renameTool.buildApprovalRequest?.(renameArgs, context);
            if (!request) {
                setResult('未生成 rename diff。');
                setInputValue('');
                return;
            }
            setPendingRename({
                request,
                args: renameArgs,
            });
        } catch (error) {
            setResult(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    }

    async function confirmRename(): Promise<void> {
        if (!pendingRename) {
            return;
        }

        setBusy(true);
        try {
            const renameResult = await renameTool.execute({
                ...pendingRename.args,
                toolCallId: 'lsp-ui-rename',
            }, context);
            setResult(renameResult.error ?? renameResult.output);
            setInputValue('');
            setPendingRename(undefined);
        } finally {
            setBusy(false);
        }
    }
}

function nextMode(mode: LspUiMode): LspUiMode {
    switch (mode) {
        case 'hover':
            return 'completion';
        case 'completion':
            return 'rename';
        case 'rename':
        default:
            return 'hover';
    }
}

function previousMode(mode: LspUiMode): LspUiMode {
    switch (mode) {
        case 'hover':
            return 'rename';
        case 'completion':
            return 'hover';
        case 'rename':
        default:
            return 'completion';
    }
}
