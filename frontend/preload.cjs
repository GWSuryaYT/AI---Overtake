const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    moveWindow:     (x, y) => ipcRenderer.send('window-move', { x, y }),
});
