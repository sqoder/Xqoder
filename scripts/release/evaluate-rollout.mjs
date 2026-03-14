#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';

const argv = process.argv.slice(2);
const args = parseArgs(argv);

const THRESHOLDS = {
    minSamples: {
        10: { stream: 200, findSymbol: 100, attachRecovery: 40 },
        30: { stream: 500, findSymbol: 250, attachRecovery: 100 },
        100: { stream: 2000, findSymbol: 1000, attachRecovery: 300 },
    },
    hold: {
        streamErrorRate: 0.005,
        findSymbolTimeoutRate: 0.01,
        attachRecoveryFailureRate: 0.015,
    },
    rollback: {
        streamErrorRate: 0.015,
        findSymbolTimeoutRate: 0.025,
        attachRecoveryFailureRate: 0.03,
    },
    stableDaysForGA: 7,
};

if (args.help || !args.metrics) {
    printHelp();
    process.exit(args.help ? 0 : 1);
}

const stage = Number(args.stage ?? 10);
if (!Number.isFinite(stage) || ![10, 30, 100].includes(stage)) {
    throw new Error('stage must be one of: 10, 30, 100');
}

const stableDays = Number(args.stableDays ?? 0);
if (!Number.isFinite(stableDays) || stableDays < 0) {
    throw new Error('stableDays must be >= 0');
}

const metricsPath = path.resolve(process.cwd(), String(args.metrics));
const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
const normalized = normalizeMetrics(metrics);
const decision = evaluate(stage, stableDays, normalized);

const report = {
    stage,
    stableDays,
    metrics: normalized,
    thresholds: THRESHOLDS,
    decision,
};

const output = JSON.stringify(report, null, 2);
if (args.output) {
    fs.writeFileSync(path.resolve(process.cwd(), String(args.output)), `${output}\n`, 'utf-8');
}
console.log(output);

if (decision.status === 'rollback') {
    process.exitCode = 2;
} else if (decision.status === 'hold') {
    process.exitCode = 1;
}

function parseArgs(input) {
    const out = {};
    for (let i = 0; i < input.length; i += 1) {
        const token = input[i];
        if (!token) {
            continue;
        }
        if (token === '--help' || token === '-h') {
            out.help = true;
            continue;
        }
        if (!token.startsWith('--')) {
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
    console.log(`Usage:\n  node scripts/release/evaluate-rollout.mjs --metrics <file> [--stage 10|30|100] [--stableDays N] [--output report.json]\n\nMetrics JSON shape:\n{\n  "stream": { "total": 1000, "errors": 3 },\n  "findSymbol": { "total": 500, "timeouts": 2 },\n  "attachRecovery": { "attempts": 120, "failures": 1 }\n}`);
}

function numberOrZero(value) {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? num : 0;
}

function ratio(numerator, denominator) {
    if (denominator <= 0) {
        return 0;
    }
    return numerator / denominator;
}

function normalizeMetrics(raw) {
    const streamTotal = numberOrZero(raw?.stream?.total);
    const streamErrors = numberOrZero(raw?.stream?.errors);
    const symbolTotal = numberOrZero(raw?.findSymbol?.total);
    const symbolTimeouts = numberOrZero(raw?.findSymbol?.timeouts);
    const recoveryAttempts = numberOrZero(raw?.attachRecovery?.attempts);
    const recoveryFailures = numberOrZero(raw?.attachRecovery?.failures);

    return {
        stream: {
            total: streamTotal,
            errors: streamErrors,
            errorRate: ratio(streamErrors, streamTotal),
        },
        findSymbol: {
            total: symbolTotal,
            timeouts: symbolTimeouts,
            timeoutRate: ratio(symbolTimeouts, symbolTotal),
        },
        attachRecovery: {
            attempts: recoveryAttempts,
            failures: recoveryFailures,
            failureRate: ratio(recoveryFailures, recoveryAttempts),
        },
    };
}

function evaluate(stage, stableDays, metrics) {
    const reasons = [];
    const warnings = [];
    const minSamples = THRESHOLDS.minSamples[stage];

    if (metrics.stream.total < minSamples.stream) {
        warnings.push(`Insufficient stream sample: ${metrics.stream.total}/${minSamples.stream}`);
    }
    if (metrics.findSymbol.total < minSamples.findSymbol) {
        warnings.push(`Insufficient find/symbol sample: ${metrics.findSymbol.total}/${minSamples.findSymbol}`);
    }
    if (metrics.attachRecovery.attempts < minSamples.attachRecovery) {
        warnings.push(`Insufficient attach recovery sample: ${metrics.attachRecovery.attempts}/${minSamples.attachRecovery}`);
    }

    if (metrics.stream.errorRate >= THRESHOLDS.rollback.streamErrorRate) {
        reasons.push(`stream error rate ${fmt(metrics.stream.errorRate)} >= rollback ${fmt(THRESHOLDS.rollback.streamErrorRate)}`);
    }
    if (metrics.findSymbol.timeoutRate >= THRESHOLDS.rollback.findSymbolTimeoutRate) {
        reasons.push(`find/symbol timeout rate ${fmt(metrics.findSymbol.timeoutRate)} >= rollback ${fmt(THRESHOLDS.rollback.findSymbolTimeoutRate)}`);
    }
    if (metrics.attachRecovery.failureRate >= THRESHOLDS.rollback.attachRecoveryFailureRate) {
        reasons.push(`attach recovery failure rate ${fmt(metrics.attachRecovery.failureRate)} >= rollback ${fmt(THRESHOLDS.rollback.attachRecoveryFailureRate)}`);
    }
    if (reasons.length > 0) {
        return {
            status: 'rollback',
            reasons,
            warnings,
            next: 'rollback-to-last-stable',
        };
    }

    const holdReasons = [];
    if (metrics.stream.errorRate >= THRESHOLDS.hold.streamErrorRate) {
        holdReasons.push(`stream error rate ${fmt(metrics.stream.errorRate)} >= hold ${fmt(THRESHOLDS.hold.streamErrorRate)}`);
    }
    if (metrics.findSymbol.timeoutRate >= THRESHOLDS.hold.findSymbolTimeoutRate) {
        holdReasons.push(`find/symbol timeout rate ${fmt(metrics.findSymbol.timeoutRate)} >= hold ${fmt(THRESHOLDS.hold.findSymbolTimeoutRate)}`);
    }
    if (metrics.attachRecovery.failureRate >= THRESHOLDS.hold.attachRecoveryFailureRate) {
        holdReasons.push(`attach recovery failure rate ${fmt(metrics.attachRecovery.failureRate)} >= hold ${fmt(THRESHOLDS.hold.attachRecoveryFailureRate)}`);
    }
    if (holdReasons.length > 0 || warnings.length > 0) {
        return {
            status: 'hold',
            reasons: holdReasons,
            warnings,
            next: stage === 100 ? 'continue-observation' : `remain-${stage}pct`,
        };
    }

    if (stage === 100 && stableDays < THRESHOLDS.stableDaysForGA) {
        return {
            status: 'hold',
            reasons: [`Stable days ${stableDays}/${THRESHOLDS.stableDaysForGA}`],
            warnings,
            next: 'wait-for-ga-window',
        };
    }

    return {
        status: 'promote',
        reasons: [],
        warnings,
        next: stage === 10 ? 'promote-to-30pct' : stage === 30 ? 'promote-to-100pct' : 'promote-to-stable',
    };
}

function fmt(value) {
    return `${(value * 100).toFixed(2)}%`;
}
