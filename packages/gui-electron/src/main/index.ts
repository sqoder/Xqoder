import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { XQoderAgent, SQLiteSessionStore } from '@xqoder/agent'

function createWindow(): void {
    const mainWindow = new BrowserWindow({
        width: 900,
        height: 670,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow.show()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

app.whenReady().then(() => {
    createWindow()

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// IPC logic for chat
ipcMain.handle('xqoder:chat', async (_event, args) => {
    const { dir, prompt } = args;

    // Create a minimal agent response for the skeleton
    // Here we would normally plug in XqoderAgent. 
    // For the skeleton, we return a mock response with the input
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(`[来自 Electron 核心]: 已收到你的内容：\n"${prompt}"\n\n(目录: ${dir})\n\n这证明了 IPC 通道与 TUI-GUI 并行是可以联通的，后续只需要接入 XQoderAgent 的流式返回逻辑即可。`);
        }, 1000);
    });
})
