import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const provider = process.env.XQODER_E2E_PROVIDER ?? 'dashscope';
const model = process.env.XQODER_E2E_MODEL ?? 'qwen-plus';
const realLlmEnabled = process.env.XQODER_REAL_LLM_E2E === '1';
const realDeployEnabled = process.env.XQODER_REAL_DEPLOY_E2E === '1';
const apiKey = process.env.DASHSCOPE_API_KEY;
const vercelToken = process.env.VERCEL_TOKEN;

run('bun', ['run', 'e2e:smoke']);

if (!realLlmEnabled || !apiKey) {
  console.log('manual e2e: preflight only (set XQODER_REAL_LLM_E2E=1 and DASHSCOPE_API_KEY to enable real fix flow)');
  process.exit(0);
}

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-manual-e2e-home-'));
const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-manual-e2e-project-'));
const srcDir = path.join(tempProject, 'src');
fs.mkdirSync(srcDir, { recursive: true });

fs.writeFileSync(path.join(tempProject, 'package.json'), JSON.stringify({
  name: 'xqoder-manual-e2e-fixture',
  private: true,
  type: 'module',
  scripts: {
    build: 'node -c src/index.js',
  },
}, null, 2));
fs.writeFileSync(path.join(srcDir, 'index.js'), [
  "export function greet(name) {",
  "  console.log(`hello ${name}`)",
  "",
].join('\n'));

const sharedEnv = {
  ...process.env,
  HOME: tempHome,
};

run('bun', ['dist/index.js', 'config', 'init', '--provider', provider, '--model', model, '--api-key', apiKey], {
  env: sharedEnv,
});
run('bun', ['dist/index.js', 'fix', '--dir', tempProject, '--model', model, '--max-attempts', '2'], {
  env: sharedEnv,
});
run('npm', ['run', 'build'], {
  cwd: tempProject,
  env: sharedEnv,
});

if (!realDeployEnabled || !vercelToken) {
  console.log('manual e2e: deploy skipped (set XQODER_REAL_DEPLOY_E2E=1 and VERCEL_TOKEN to enable deploy flow)');
  process.exit(0);
}

run('bun', ['dist/index.js', 'deploy', '--dir', tempProject, '--token', vercelToken], {
  env: sharedEnv,
});

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
}
