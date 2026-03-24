import { ConfigManager, getDefaultModelForProvider, getKnownModelsForProvider, resolveConfigWithEnvOverrides, SUPPORTED_LLM_PROVIDERS, type LLMProviderName } from '@xqoder/shared';

interface SessionControllerDeps {
    dispatch: (event: unknown) => void;
    renderNow: () => Promise<unknown>;
    listLocalSessions: (dir: string, limit: number) =>
        Promise<Array<{ id: string; title?: string | null }>> | Array<{ id: string; title?: string | null }>;
    listRemoteSessions: (dir: string, limit: number) => Promise<Array<{ id: string; title?: string | null }>>;
    createRemoteSession: (dir: string) => Promise<{ id: string; title: string }>;
    setActiveSessionId: (sessionId: string | undefined) => void;
}

export class SessionController {
    constructor(private readonly deps: SessionControllerDeps) {}

    openSessionOverlay(dir: string, attachBaseUrl?: string): void {
        this.deps.dispatch({ type: 'editor.reset' });
        void this.deps.renderNow();
        void (async () => {
            try {
                let items: Array<{ id: string; title: string }>;
                if (attachBaseUrl) {
                    const list = await this.deps.listRemoteSessions(dir, 20);
                    items = list.map((s) => ({ id: s.id, title: s.title || s.id }));
                } else {
                    const list = await this.deps.listLocalSessions(dir, 20);
                    items = list.map((s) => ({ id: s.id, title: s.title || s.id }));
                }
                this.deps.dispatch({ type: 'overlay.open', kind: 'session', items });
            } catch (err) {
                this.deps.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
            }
            await this.deps.renderNow();
        })();
    }

    createNewSession(dir: string, attachBaseUrl?: string): void {
        this.deps.dispatch({ type: 'editor.reset' });
        void this.deps.renderNow();
        if (attachBaseUrl) {
            void (async () => {
                try {
                    const created = await this.deps.createRemoteSession(dir);
                    this.deps.setActiveSessionId(created.id);
                    this.deps.dispatch({
                        type: 'session.restored',
                        sessionId: created.id,
                        title: created.title,
                        messages: [],
                    });
                    this.deps.dispatch({ type: 'notice.set', notice: `New session: ${created.title}` });
                } catch (err) {
                    this.deps.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                }
                await this.deps.renderNow();
            })();
            return;
        }

        this.deps.setActiveSessionId(undefined);
        this.deps.dispatch({ type: 'session.new' });
    }

    openModelOverlay(dir: string, currentModel?: string, fallbackModel?: string): void {
        const loadedConfig = new ConfigManager().load({ cwd: dir });
        const { config } = resolveConfigWithEnvOverrides(loadedConfig);
        const current = currentModel ?? fallbackModel ?? config.llm.model;
        const providers = [...SUPPORTED_LLM_PROVIDERS];
        let providerIndex = providers.findIndex((p) => getDefaultModelForProvider(p) === current || getKnownModelsForProvider(p).includes(current));
        if (providerIndex < 0) {
            providerIndex = 0;
        }
        const items = getKnownModelsForProvider(providers[providerIndex]! as LLMProviderName).map((id) => ({ id, label: id }));
        this.deps.dispatch({ type: 'overlay.open', kind: 'model', providers, providerIndex, items });
    }
}
