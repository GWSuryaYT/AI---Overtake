const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
const path = require('path');

// Allow autoplay without user gesture requirements
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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

    // Start with clicks ignored (pass-through) on transparent space by default,
    // but forwarding mouse moves so the renderer can hit-test the character and UI
    win.setIgnoreMouseEvents(true, { forward: true });

    // ── Handle dragging the borderless window ──
    ipcMain.on('window-move', (event, { x, y }) => {
        if (!win || win.isDestroyed()) return;
        const [curX, curY] = win.getPosition();
        win.setPosition(curX + x, curY + y);
    });

    // ── Handle dynamic mouse click-through toggling ──
    ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
        const webContents = event.sender;
        const targetWin = BrowserWindow.fromWebContents(webContents);
        if (!targetWin || targetWin.isDestroyed()) return;
        if (ignore) {
            targetWin.setIgnoreMouseEvents(true, { forward: true, ...(options || {}) });
        } else {
            targetWin.setIgnoreMouseEvents(false);
        }
    });

    // ── Return current display dimensions ──
    ipcMain.handle('get-screen-size', () => {
        if (!win || win.isDestroyed()) return { width: 1920, height: 1080 };
        const display = screen.getDisplayNearestPoint(win.getBounds());
        return { width: display.workArea.width, height: display.workArea.height };
    });

}

app.whenReady().then(() => {
    // Automatically grant media/microphone permissions in Electron session
    if (session.defaultSession) {
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            callback(true);
        });

        session.defaultSession.setPermissionCheckHandler(() => {
            return true;
        });
    }
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
