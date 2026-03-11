declare global {
    interface Window {
        api: {
            chat: (dir: string, prompt: string) => Promise<string>
        }
    }
}

export { }
