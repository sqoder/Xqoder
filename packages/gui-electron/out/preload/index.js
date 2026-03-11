"use strict";
const electron = require("electron");
const api = {
  chat: (dir, prompt) => electron.ipcRenderer.invoke("xqoder:chat", { dir, prompt })
};
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.api = api;
}
