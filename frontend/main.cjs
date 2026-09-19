const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// Compact window dimensions (default state)
const COMPACT_W = 600;
const COMPACT_H = 1000;

let win = null;

function createWindow() {
    win = new BrowserWindow({
        width: COMPACT_W,
        height: COMPACT_H,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        hasShadow: false,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.loadURL('http://localhost:5173').catch(() => {
        win.loadFile('dist/index.html');
    });

    // Uncomment to open DevTools for debugging
    // win.webContents.openDevTools({ mode: 'detach' });

    // ── Handle dragging the borderless window ──
    ipcMain.on('window-move', (event, { x, y }) => {
        if (!win) return;
        const bounds = win.getBounds();
        win.setBounds({
            x: bounds.x + x,
            y: bounds.y + y,
            width: bounds.width,
            height: bounds.height
        });
    });

    // ── Return current display dimensions ──
    ipcMain.handle('get-screen-size', () => {
        if (!win) return { width: 1920, height: 1080 };
        const display = screen.getDisplayNearestPoint(win.getBounds());
        return { width: display.workArea.width, height: display.workArea.height };
    });

}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
