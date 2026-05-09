import { describe, expect, it } from 'bun:test';
import { removeRepeatedAssistantSections } from '../../../src/application/chat/response-cleanup.js';

describe('assistant response cleanup', () => {
    it('removes repeated long answer sections while preserving the first copy', () => {
        const repeated = [
            '我已经查看了这个仓库。它是一个基于 TypeScript、Bun 和 Ink 的终端 CLI 项目，核心入口在 src/entrypoints/cli.tsx，配置证据来自 package.json。',
            '',
            '我已经查看了这个仓库。它是一个基于 TypeScript、Bun 和 Ink 的终端 CLI 项目，核心入口在 src/entrypoints/cli.tsx，配置证据来自 package.json。',
            '',
            '另外，src/tools 目录说明它通过本地工具链完成文件读取、命令执行和网络检查。',
        ].join('\n');

        const cleaned = removeRepeatedAssistantSections(repeated);

        expect(cleaned.match(/我已经查看了这个仓库/g)).toHaveLength(1);
        expect(cleaned).toContain('src/tools');
    });

    it('trims a restarted repository answer when the second copy is paraphrased', () => {
        const repeated = [
            '`free-code` 是一个基于 Anthropic 官方 Claude Code CLI 源码快照构建的去遥测、去安全提示层、全功能解锁的开源终端 AI 编程助手。',
            '',
            '核心特点如下：',
            '',
            '✅ **完全去遥测（Telemetry Removed）**',
            '- 移除了 OpenTelemetry/gRPC、GrowthBook 分析、Sentry 错误上报、自定义事件日志等所有外发行为；',
            '- 无崩溃报告、无使用统计、无会话指纹。',
            '',
            '🔧 **技术栈**',
            '- Bun + TypeScript + React + Ink（终端 UI）',
            '- `src/bridge/` 负责远程控制、MCP 桥接、环境注册和心跳保活。',
            '',
            '需要我帮你：',
            '- 对比它和官方 Claude Code 的具体差异点？',
            '- 分析某段关键源码？',
            '',
            '欢迎随时指定 👇`free-code` 是一个基于 Anthropic 官方 Claude Code CLI 源码快照构建的去中心化、无遥测、全功能解锁版终端 AI 编程助手。',
            '',
            '核心特点如下：',
            '',
            '✅ **完全移除遥测**',
            '- 删除所有 OpenTelemetry/gRPC、GrowthBook 分析、Sentry 错误上报、自定义事件日志。',
        ].join('\n');

        const cleaned = removeRepeatedAssistantSections(repeated);

        expect(cleaned.match(/`free-code` 是一个基于 Anthropic 官方/g)).toHaveLength(1);
        expect(cleaned).toContain('src/bridge/');
        expect(cleaned).toContain('分析某段关键源码');
        expect(cleaned).not.toContain('去中心化、无遥测');
        expect(cleaned).not.toContain('欢迎随时指定');
    });

    it('trims repeated GitHub repository introductions even when the kept answer contains code fences', () => {
        const repeated = [
            '我已经检查了 GitHub 仓库 https://github.com/paoloanzn/free-code.git，这是一个名为 **free-code** 的开源项目。',
            '',
            '### 核心定位',
            '- 这是 Claude Code 的自由构建版。',
            '- 证据来自 README.md、FEATURES.md、package.json、src/bridge/bridgeApi.ts。',
            '',
            '### 使用方式',
            '```bash',
            'curl -fsSL https://raw.githubusercontent.com/paoloanzn/free-code/main/install.sh | bash',
            'free-code',
            '```',
            '',
            '需要我帮你：',
            '- 对比它和官方 Claude Code 的具体差异？',
            '',
            '请告诉我 👇我已经检查了 GitHub 仓库 https://github.com/paoloanzn/free-code.git，这是一个名为 **free-code** 的开源项目。',
            '',
            '根据仓库信息，这是一个 **Claude Code 的免费构建版本**，主要特点包括：',
            '',
            '### 项目定位',
            '- 这是 Anthropic 公司的 Claude Code CLI 的可构建源码分支。',
            '',
            '请告诉我 👇我已经查看了 GitHub 仓库 https://github.com/paoloanzn/free-code.git 的内容。这是一个名为 **free-code** 的开源项目。',
        ].join('\n');

        const cleaned = removeRepeatedAssistantSections(repeated);

        expect(cleaned.match(/我已经(?:检查|查看)了 GitHub 仓库 https:\/\/github.com\/paoloanzn\/free-code\.git/g)).toHaveLength(1);
        expect(cleaned).toContain('src/bridge/bridgeApi.ts');
        expect(cleaned).toContain('```bash');
        expect(cleaned).toContain('curl -fsSL');
        expect(cleaned).not.toContain('Claude Code 的免费构建版本');
        expect(cleaned).not.toContain('我已经查看了 GitHub 仓库');
        expect(cleaned).not.toContain('请告诉我 👇');
    });

    it('trims a restarted repository answer when intro switches from URL form to repo-name form', () => {
        const repeated = [
            '`https://github.com/paoloanzn/free-code.git` 是一个开源项目，名为 **free-code**。',
            '',
            '### 核心定位',
            '- 这是一个可构建 CLI 快照分支。',
            '- 证据来自 README、FEATURES 与 package.json。',
            '',
            '如需进一步分析某模块，可以继续指定路径。',
            '`free-code` 是一个基于 Anthropic 官方 Claude Code CLI 源码快照构建的开源终端 AI 编程助手。',
            '',
            '核心特点如下：',
            '- 完全移除遥测。',
        ].join('\n');

        const cleaned = removeRepeatedAssistantSections(repeated);

        expect(cleaned.match(/`https:\/\/github\.com\/paoloanzn\/free-code\.git` 是一个开源项目/g)).toHaveLength(1);
        expect(cleaned).toContain('可构建 CLI 快照分支');
        expect(cleaned).not.toContain('`free-code` 是一个基于 Anthropic 官方');
        expect(cleaned).not.toContain('核心特点如下');
    });

    it('removes emoji lead-in text before a restarted GitHub repository answer', () => {
        const repeated = [
            '我已经检查了 GitHub 仓库 https://github.com/paoloanzn/free-code.git，这是一个名为 **free-code** 的开源项目。',
            '',
            '它使用 Bun、TypeScript、React 和 Ink 实现终端交互，并把工具结果与 assistant 文本分开处理。',
            '',
            '欢迎随时告诉我！ 😊我已经检查了 GitHub 仓库 https://github.com/paoloanzn/free-code.git，这是一个名为 **free-code** 的开源项目。',
            '',
            '第二遍重复内容不应该保留。',
        ].join('\n');

        const cleaned = removeRepeatedAssistantSections(repeated);

        expect(cleaned.match(/我已经检查了 GitHub 仓库 https:\/\/github.com\/paoloanzn\/free-code\.git/g)).toHaveLength(1);
        expect(cleaned).toContain('工具结果与 assistant 文本分开处理');
        expect(cleaned).not.toContain('欢迎随时告诉我');
        expect(cleaned).not.toContain('第二遍重复内容');
    });

    it('trims an incomplete GitHub restart tail that only reaches the GitHub prefix', () => {
        const repeated = [
            '我已经检查了 GitHub 仓库 https://github.com/paoloanzn/free-code.git，这是一个名为 **free-code** 的开源项目。',
            '',
            '该项目强调可构建、可审计、去遥测，并保留主要 CLI 工作流。',
            '',
            '我已经查看了 GitHub',
        ].join('\n');

        const cleaned = removeRepeatedAssistantSections(repeated);

        expect(cleaned).toContain('该项目强调可构建、可审计、去遥测');
        expect(cleaned).not.toContain('我已经查看了 GitHub');
        expect(cleaned.match(/我已经(?:检查|查看)了 GitHub/g)).toHaveLength(1);
    });

    it('trims a repeated subject restart after a code-fenced section', () => {
        const repeated = [
            '`free-code` 是一个基于 Anthropic 官方 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 源码快照（2026年3月31日公开）构建的**去监控、去安全护栏、全功能解锁**的开源终端 AI 编程助手。',
            '',
            '核心特点如下：',
            '',
            '✅ **零遥测（Telemetry Removed）**',
            '- 移除所有 OpenTelemetry/gRPC 上报、GrowthBook 分析、Sentry 错误追踪、自定义事件日志；',
            '',
            '📦 **项目结构清晰分层**',
            '- `src/commands/`：各类 CLI 子命令。',
            '- `src/bridge/`：远程控制桥接核心。',
            '',
            '```bash',
            'free-code',
            '/login',
            '```',
            '',
            '需要我帮你：',
            '- 对比它和 XQoder 的定位差异？',
            '- 查看某个具体功能（如 `BRIDGE_MODE`）的实现细节？',
            '欢迎继续提问 👇`free-code` 是一个基于 Anthropic 官方 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 源码快照（2026年3月31日公开）构建的**去监控、去安全护栏、全功能解锁**的开源终端 AI 编程助手。',
            '',
            '核心特点如下：',
            '',
            '✅ **零遥测（Telemetry Removed）**',
            '- 移除了 OpenTelemetry/gRPC 上报、GrowthBook 分析、Sentry 错误追踪、自定义事件日志等全部外呼行为。',
        ].join('\n');

        const cleaned = removeRepeatedAssistantSections(repeated);

        expect(cleaned.match(/`free-code` 是一个基于 Anthropic 官方/g)).toHaveLength(1);
        expect(cleaned).toContain('```bash');
        expect(cleaned).toContain('/login');
        expect(cleaned).toContain('BRIDGE_MODE');
        expect(cleaned).not.toContain('等全部外呼行为');
        expect(cleaned).not.toContain('欢迎继续提问');
    });

    it('does not deduplicate code fenced content', () => {
        const content = [
            '```ts',
            'const value = 1;',
            '```',
            '',
            '```ts',
            'const value = 1;',
            '```',
        ].join('\n');

        expect(removeRepeatedAssistantSections(content)).toBe(content);
    });
});
