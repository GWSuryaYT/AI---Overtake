import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

function annaDevApiPlugin() {
    return {
        name: 'anna-dev-api-plugin',
        configureServer(server) {
            // Save Gesture Library
            server.middlewares.use('/__anna/save-gestures', (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                    return;
                }

                let body = '';
                req.on('data', chunk => { body += chunk; });
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

                        if (fs.existsSync(targetPath)) {
                            fs.copyFileSync(targetPath, backupPath);
                        }

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

            // Save Emotion Map
            server.middlewares.use('/__anna/save-emotions', (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                    return;
                }

                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    try {
                        const payload = JSON.parse(body);
                        const targetPath = path.resolve(__dirname, 'src/avatar/emotion_map.json');
                        const backupDir = path.resolve(__dirname, '../.anna_backups');

                        if (!fs.existsSync(backupDir)) {
                            fs.mkdirSync(backupDir, { recursive: true });
                        }

                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const backupPath = path.join(backupDir, `emotion_map_${timestamp}.json`);

                        if (fs.existsSync(targetPath)) {
                            fs.copyFileSync(targetPath, backupPath);
                        }

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

            // List Animation Clips
            server.middlewares.use('/__anna/list-clips', (req, res) => {
                try {
                    const clipsDir = path.resolve(__dirname, 'src/avatar/clips');
                    if (!fs.existsSync(clipsDir)) {
                        fs.mkdirSync(clipsDir, { recursive: true });
                    }
                    const files = fs.readdirSync(clipsDir).filter(f => f.endsWith('.json'));
                    const clips = [];
                    for (const file of files) {
                        try {
                            const content = JSON.parse(fs.readFileSync(path.join(clipsDir, file), 'utf-8'));
                            clips.push(content);
                        } catch (e) {}
                    }
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ clips }));
                } catch (err) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: err.message }));
                }
            });

            // Save Animation Clip (for Bone Editor clips)
            server.middlewares.use('/__anna/save-clip', (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                    return;
                }

                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    try {
                        const clip = JSON.parse(body);
                        if (!clip.name) throw new Error('Clip must have a name');

                        const clipsDir = path.resolve(__dirname, 'src/avatar/clips');
                        if (!fs.existsSync(clipsDir)) {
                            fs.mkdirSync(clipsDir, { recursive: true });
                        }

                        const targetPath = path.join(clipsDir, `${clip.name}.json`);
                        const backupDir = path.resolve(__dirname, '../.anna_backups');

                        if (!fs.existsSync(backupDir)) {
                            fs.mkdirSync(backupDir, { recursive: true });
                        }

                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const backupPath = path.join(backupDir, `clip_${clip.name}_${timestamp}.json`);

                        if (fs.existsSync(targetPath)) {
                            fs.copyFileSync(targetPath, backupPath);
                        }

                        const formatted = JSON.stringify(clip, null, 2);
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
    plugins: [annaDevApiPlugin()]
});
