import { contextBridge, ipcRenderer } from 'electron'

const api = {
    chat: (dir: string, prompt: string) => ipcRenderer.invoke('xqoder:chat', { dir, prompt })
}

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('api', api)
    } catch (error) {
        console.error(error)
    }
} else {
    // @ts-expect-error (define in dts)
    window.api = api
}
