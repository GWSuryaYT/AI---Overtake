import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

function annaGestureSavePlugin() {
    return {
        name: 'anna-gesture-save-plugin',
        configureServer(server) {
            server.middlewares.use('/__anna/save-gestures', (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                    return;
                }

                let body = '';
                req.on('data', chunk => {
                    body += chunk;
                });

                req.on('end', () => {
                    try {
                        const payload = JSON.parse(body);
                        const targetPath = path.resolve(__dirname, 'src/avatar/gesture_library.json');
                        const backupDir = path.resolve(__dirname, '../.anna_backups');

                        if (!fs.existsSync(backupDir)) {
                            fs.mkdirSync(backupDir, { recursive: true });
                        }

                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const backupPath = path.join(backupDir, `gesture_library_${timestamp}.json`);

                        // Keep timestamped backup if target exists
                        if (fs.existsSync(targetPath)) {
                            fs.copyFileSync(targetPath, backupPath);
                        }

                        // Write to temp file then rename for atomic write
                        const formatted = JSON.stringify(payload, null, 2);
                        const tempPath = targetPath + '.tmp';
                        fs.writeFileSync(tempPath, formatted, 'utf-8');
                        fs.renameSync(tempPath, targetPath);

                        res.statusCode = 200;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({
                            success: true,
                            path: targetPath,
                            backupPath: backupPath
                        }));
                    } catch (err) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
            });
        }
    };
}

export default defineConfig({
    plugins: [annaGestureSavePlugin()]
});
