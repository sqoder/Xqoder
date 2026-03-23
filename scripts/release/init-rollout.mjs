#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';

const rootDir = process.cwd();
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
    printHelp();
    process.exit(0);
}

const release = sanitizeRelease(String(args.release ?? pkg.version ?? '').trim());
if (!release) {
    throw new Error('release is required (either --release or package.json version)');
}

const defaultOutputDir = path.join('docs', 'artifacts', 'release', 'rollout', release);
const outputDir = path.resolve(rootDir, String(args.outputDir ?? defaultOutputDir));
const overwrite = toBoolean(args.overwrite ?? false);

ensureOutputDir(outputDir, overwrite);

const stageFiles = [
    {
        stage: 10,
        file: path.join(outputDir, 'metrics-stage10.json'),
        reportFile: path.join(outputDir, 'report-stage10.json'),
    },
    {
        stage: 30,
        file: path.join(outputDir, 'metrics-stage30.json'),
        reportFile: path.join(outputDir, 'report-stage30.json'),
    },
    {
        stage: 100,
        file: path.join(outputDir, 'metrics-stage100.json'),
        reportFile: path.join(outputDir, 'report-stage100.json'),
    },
];

for (const item of stageFiles) {
    const payload = buildMetricsTemplate(release, item.stage);
    fs.writeFileSync(item.file, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

const checklistPath = path.join(outputDir, 'checklist.md');
fs.writeFileSync(checklistPath, `${buildChecklist({
    release,
    outputDir,
    stageFiles,
})}\n`, 'utf-8');

console.log(JSON.stringify({
    release,
    outputDir: path.relative(rootDir, outputDir),
    files: {
        metrics: stageFiles.map((item) => path.relative(rootDir, item.file)),
        checklist: path.relative(rootDir, checklistPath),
    },
    commands: stageFiles.map((item) => {
        const metricsRel = normalizePath(path.relative(rootDir, item.file));
        const reportRel = normalizePath(path.relative(rootDir, item.reportFile));
        const stableDaysArg = item.stage === 100 ? ' --stableDays 7' : '';
        return `pnpm release:rollout:check -- --metrics ${metricsRel} --stage ${item.stage}${stableDaysArg} --output ${reportRel}`;
    }),
}, null, 2));

function parseArgs(input) {
    const out = {};
    for (let i = 0; i < input.length; i += 1) {
        const token = input[i];
        if (!token || !token.startsWith('--')) {
            continue;
        }
        const [key, inlineValue] = token.slice(2).split('=', 2);
        if (inlineValue !== undefined) {
            out[key] = inlineValue;
            continue;
        }
        const next = input[i + 1];
        if (next && !next.startsWith('--')) {
            out[key] = next;
            i += 1;
        } else {
            out[key] = true;
        }
    }
    return out;
}

function printHelp() {
    console.log(`Usage:
  node scripts/release/init-rollout.mjs [--release 0.1.0-rc.202603230340] [--outputDir docs/artifacts/release/rollout/<release>] [--overwrite]

Description:
  Initialize rollout execution bundle (metrics templates + checklist) for stage 10/30/100.
`);
}

function sanitizeRelease(value) {
    if (!value) {
        return '';
    }
    if (!/^[A-Za-z0-9._-]+$/.test(value)) {
        throw new Error(`Invalid release identifier: ${value}`);
    }
    return value;
}

function toBoolean(value) {
    if (value === true) {
        return true;
    }
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function ensureOutputDir(dir, overwrite) {
    if (fs.existsSync(dir)) {
        const entries = fs.readdirSync(dir);
        if (entries.length > 0 && !overwrite) {
            throw new Error(`Output directory already exists and is not empty: ${dir}. Use --overwrite to regenerate.`);
        }
    }
    fs.mkdirSync(dir, { recursive: true });
}

function buildMetricsTemplate(release, stage) {
    return {
        release,
        stage,
        collectedAt: '',
        window: '',
        notes: '',
        stream: {
            total: 0,
            errors: 0,
        },
        findSymbol: {
            total: 0,
            timeouts: 0,
        },
        attachRecovery: {
            attempts: 0,
            failures: 0,
        },
    };
}

function buildChecklist({ release, outputDir, stageFiles }) {
    const generatedAt = new Date().toISOString();
    const outputRel = normalizePath(path.relative(rootDir, outputDir));

    const stageSections = stageFiles.map((item) => {
        const metricsRel = normalizePath(path.relative(rootDir, item.file));
        const reportRel = normalizePath(path.relative(rootDir, item.reportFile));
        const stableDaysArg = item.stage === 100 ? ' --stableDays 7' : '';
        const nextHint = item.stage === 10
            ? 'Promote target: 30%'
            : item.stage === 30
                ? 'Promote target: 100%'
                : 'Promote target: Stable (GA)';
        return `### Stage ${item.stage}%\n\n1. 填写指标文件：\`${metricsRel}\`\n2. 执行评估：\n\n\`\`\`bash\npnpm release:rollout:check -- --metrics ${metricsRel} --stage ${item.stage}${stableDaysArg} --output ${reportRel}\n\`\`\`\n\n3. 读取评估结果：\`${reportRel}\`\n4. 根据 exit code 判定：\`0 promote / 1 hold / 2 rollback\`\n5. ${nextHint}`;
    }).join('\n\n');

    return `# Rollout Checklist (${release})\n\nGenerated: ${generatedAt}\nBundle dir: \`${outputRel}\`\n\n本清单用于执行 RC/Beta 发布后的分阶段放量门禁（10% -> 30% -> 100%）。\n\n${stageSections}\n\n## References\n\n- \`docs/release-rollout-runbook.md\`\n- \`scripts/release/evaluate-rollout.mjs\`\n`;
}

function normalizePath(input) {
    return input.split(path.sep).join('/');
}

