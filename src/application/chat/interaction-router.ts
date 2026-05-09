import type {
    ChatInteractionKind,
    ChatInteractionRoute,
} from './interaction-types.js';
export type {
    ChatInteractionKind,
    ChatInteractionRoute,
} from './interaction-types.js';

const PROJECT_EXPLANATION_TRIGGER = /(?:this project|this repo|current project|current repo|workspace|codebase|这个项目|当前项目|这个仓库|当前仓库|这个代码库|当前代码库|解释.*项目|分析.*项目|解释.*仓库|分析.*仓库)/i;
const MODEL_IDENTITY_TRIGGER = /(?:what model|which model)|(?:你是什么模型|你是什麼模型|什么模型|什麼模型|哪个模型|哪個模型|当前模型|當前模型|模型是什么|模型是什麼|你用的模型)/i;
const CAPABILITY_TRIGGER = /^(?:what can you do(?: for me)?|what do you do|how can you help(?: me)?|what can you help(?: with)?|[你您](?:都)?(?:能|可以)(?:帮我)?(?:做些?什么|做啥|干嘛)(?:呢|呀|啊)?)[.!?。！？]?$/i;
const CONFIG_OR_RUNTIME_TRIGGER = /(?:auth|api key|apikey|provider|proxy|doctor|config|configuration|credential|token|session|sandbox|permission|permissions|login|baseurl|base url|登录|登入|配置|设定|設定|代理|网络|網絡|凭证|憑證|密钥|密鑰|秘钥|令牌|会话|會話|沙箱|权限|權限)/i;
const LOCAL_PATH_TRIGGER = /(?:^|\s|["'`([{<])(?:~\/|\.{1,2}\/|\/[^\s"'`)\]}>\u3000]+|[A-Za-z]:[\\/][^\s"'`)\]}>\u3000]+)/;
const ENGINEERING_INTENT_TRIGGER = /(?:src\/|test\/|dist\/|\.ts\b|\.tsx\b|\.js\b|\.jsx\b|\.json\b|\.md\b|\.html?\b|\.css\b|\.scss\b|\.ya?ml\b|\.txt\b|bug|error|exception|typeerror|build|test|lint|coverage|cli|tui|mvp|stack trace|fix|implement|refactor|debug|inspect|read|search|run|execute|delete|remove|edit|modify|write|regression|continue current task|continue the task|add (?:a )?feature|new feature|按.*文档|根据.*文档|继续当前任务|继续这个任务|继续任务|继续推进|接着推进|继续完成|继续修|继续改|修复|改代码|修改代码|实现|接入|新增功能|新增一个功能|新增特性|删除|清理|检查|搜索|读取|运行|构建|测试|调试|重构|报错|异常|需求|代码|文件|函数|接口|类型|测试用例|命令|脚本|继续处理|分析.*文件|解释.*文件|查看.*文件)/i;
const LOCAL_PATH_ANALYSIS_TRIGGER = /(?:analy[sz]e|explain|summari[sz]e|what is|what does|review|describe|分析|解释|说明|总结|看看|看下|看一下|是什么|是一个什么|干什么|做什么|项目)/i;
const LOCAL_PATH_MUTATION_TRIGGER = /(?:\b(?:fix|implement|refactor|debug|edit|modify|write|delete|remove|rename|move|copy|save|install|run|execute|build|test)\b|修复|实现|重构|调试|修改|编辑|写入|删除|移除|重命名|移动|复制|保存|安装|运行|执行|构建|测试|新增|创建|生成)/i;

export function resolveChatInteraction(prompt: string): ChatInteractionRoute {
    const normalizedPrompt = normalizePrompt(prompt);

    if (!normalizedPrompt) {
        return buildRoute('casual', normalizedPrompt);
    }
    if (MODEL_IDENTITY_TRIGGER.test(normalizedPrompt)) {
        return buildRoute('identity', normalizedPrompt);
    }
    if (CAPABILITY_TRIGGER.test(normalizedPrompt)) {
        return buildRoute('capability', normalizedPrompt);
    }
    if (LOCAL_PATH_TRIGGER.test(normalizedPrompt)) {
        if (isLocalPathAnalysisPrompt(normalizedPrompt)) {
            return buildRoute('file_analysis', normalizedPrompt);
        }
        return buildRoute('engineering_task', normalizedPrompt);
    }
    if (CONFIG_OR_RUNTIME_TRIGGER.test(normalizedPrompt)) {
        return buildRoute('config_or_runtime', normalizedPrompt);
    }
    if (ENGINEERING_INTENT_TRIGGER.test(normalizedPrompt)) {
        return buildRoute('engineering_task', normalizedPrompt);
    }
    if (PROJECT_EXPLANATION_TRIGGER.test(normalizedPrompt)) {
        return buildRoute('project_explanation', normalizedPrompt);
    }
    return buildRoute('casual', normalizedPrompt);
}

function isLocalPathAnalysisPrompt(normalizedPrompt: string): boolean {
    return LOCAL_PATH_ANALYSIS_TRIGGER.test(normalizedPrompt)
        && !LOCAL_PATH_MUTATION_TRIGGER.test(normalizedPrompt);
}

function buildRoute(
    kind: ChatInteractionKind,
    normalizedPrompt: string,
): ChatInteractionRoute {
    return {
        kind,
        normalizedPrompt,
        usesStructuredResponse: kind === 'engineering_task',
        includesRuntimeIdentity: kind === 'identity',
        augmentsProjectContext: kind === 'project_explanation',
        addsCapabilityGuidance: kind === 'capability',
    };
}

function normalizePrompt(prompt: string): string {
    return prompt.replace(/\s+/g, ' ').trim();
}
