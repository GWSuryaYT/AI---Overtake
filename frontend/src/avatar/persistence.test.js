import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { validateGestureLibrary, validateGestureProgram } from './studio_validator.js';
import libraryData from './gesture_library.json';

describe('Gesture Studio Persistence & Validation', () => {
    it('Loaded gesture_library.json equals valid library format', () => {
        expect(libraryData.GESTURE_LIBRARY).toBeDefined();
        expect(libraryData.GESTURE_MODES).toBeDefined();

        const res = validateGestureLibrary(libraryData);
        expect(res.valid).toBe(true);
        expect(res.errors.length).toBe(0);
    });

    it('Atomic save & backup creation preserves integrity', () => {
        const backupDir = path.resolve(__dirname, '../../../.anna_backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const testBackupPath = path.join(backupDir, `test_backup_${timestamp}.json`);

        // Test writing backup
        fs.writeFileSync(testBackupPath, JSON.stringify(libraryData, null, 2), 'utf-8');
        expect(fs.existsSync(testBackupPath)).toBe(true);

        // Read back and compare
        const loaded = JSON.parse(fs.readFileSync(testBackupPath, 'utf-8'));
        expect(loaded.GESTURE_LIBRARY.wave.keys.length).toBe(libraryData.GESTURE_LIBRARY.wave.keys.length);

        // Cleanup test backup
        fs.unlinkSync(testBackupPath);
    });

    it('Rejects invalid data with specific error messages', () => {
        const invalidPayload = {
            GESTURE_LIBRARY: {
                broken_gesture: {
                    keys: [
                        { t: [0.4, 0.1], pos: ['not', 'a', 'number'] }
                    ]
                }
            }
        };

        const res = validateGestureLibrary(invalidPayload);
        expect(res.valid).toBe(false);
        expect(res.errors.length).toBeGreaterThan(0);
        expect(res.errors.some(e => e.includes('must be <='))).toBe(true);
        expect(res.errors.some(e => e.includes('must be a valid number'))).toBe(true);
    });

    it('Flags the current shy entry pos.y = +0.48 as a warning', () => {
        const shyProg = libraryData.GESTURE_LIBRARY.shy;
        expect(shyProg).toBeDefined();

        const res = validateGestureProgram('shy', shyProg);
        expect(res.valid).toBe(true); // structurally valid
        expect(res.warnings.some(w => w.includes('chin/head height'))).toBe(true);
    });
});
