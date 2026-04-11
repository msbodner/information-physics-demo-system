const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  appVersion: "3.0.0",
  platform: process.platform,
  isElectron: true,

  // Storage settings — opens native directory picker, returns absolute path or null
  chooseDirectory: (target) => ipcRenderer.invoke("storage:chooseDirectory", target),

  // Writes a file to the directory stored for the given target
  // content is a UTF-8 string; the main process stores the directory per target
  saveFile: (target, filename, content) => ipcRenderer.invoke("storage:saveFile", { target, filename, content }),

  // Sets the directory for a target (called by StorageSettingsPane after chooseDirectory)
  setDirectory: (target, dir) => ipcRenderer.invoke("storage:setDirectory", { target, dir }),

  // Returns the currently stored directory (if any) for a target
  getDirectory: (target) => ipcRenderer.invoke("storage:getDirectory", target),
});
