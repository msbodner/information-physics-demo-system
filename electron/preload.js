const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  appVersion: "2.1a",
  platform: process.platform,
  isElectron: true,
});
