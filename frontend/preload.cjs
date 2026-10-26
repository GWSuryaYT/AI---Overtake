const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    moveWindow:           (x, y) => ipcRenderer.send('window-move', { x, y }),
    setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
    getScreenSize:        () => ipcRenderer.invoke('get-screen-size'),
});
