import { describe, it, expect } from 'vitest';
import { ProgramPlayer } from './program_player.js';
import { avatarLayers, toggleLayer, isLayerEnabled } from './layers.js';
import gestureLib from './gesture_library.json';

describe('Control Audit & Measurable Effect Verification', () => {
    it('Oscillator kind drives measurably distinct motions', () => {
        const baseOscProg = {
            lead: 'dominant',
            pole: 'elbow_down',
            keys: [
                { t: [0.2, 0.2], pos: [0.3, -0.5, 0.6], palm: 'inward', shape: 'soft_open' }
            ],
            oscillate: {
                cycles: [3, 3],
                freq: [2.5, 2.5],
                ampDeg: [20, 20],
                decay: 0.8
            },
            hold: [0.2, 0.2],
            release: 'LIVE_IDLE'
        };

        const swingProg = { ...baseOscProg, oscillate: { ...baseOscProg.oscillate, kind: 'forearm_swing' } };
        const pulseProg = { ...baseOscProg, oscillate: { ...baseOscProg.oscillate, kind: 'point_pulse' } };
        const rollProg = { ...baseOscProg, oscillate: { ...baseOscProg.oscillate, kind: 'wrist_roll' } };

        const playerSwing = new ProgramPlayer(swingProg, { deterministic: true });
        const playerPulse = new ProgramPlayer(pulseProg, { deterministic: true });
        const playerRoll = new ProgramPlayer(rollProg, { deterministic: true });

        const oscPeakT = playerSwing.getOscPeakTime();
        expect(oscPeakT).not.toBeNull();

        const poseSwing = playerSwing.evaluate(oscPeakT);
        const posePulse = playerPulse.evaluate(oscPeakT);
        const poseRoll = playerRoll.evaluate(oscPeakT);

        // Forearm swing modulates X (lateral)
        expect(poseSwing.posU[0]).not.toEqual(baseOscProg.keys[0].pos[0]);

        // Point pulse modulates Z (forward/depth)
        expect(posePulse.posU[2]).not.toEqual(baseOscProg.keys[0].pos[2]);

        // All three kinds must yield distinct posU coordinates
        expect(poseSwing.posU).not.toEqual(posePulse.posU);
        expect(poseSwing.posU).not.toEqual(poseRoll.posU);
        expect(posePulse.posU).not.toEqual(poseRoll.posU);

        expect(poseSwing.oscKind).toBe('forearm_swing');
        expect(posePulse.oscKind).toBe('point_pulse');
        expect(poseRoll.oscKind).toBe('wrist_roll');
    });

    it('Oscillator frequency and cycles measurably change segment timing', () => {
        const progFast = {
            keys: [{ t: [0.2, 0.2], pos: [0.3, -0.5, 0.6] }],
            oscillate: { cycles: [2, 2], freq: [4.0, 4.0], ampDeg: [15, 15], decay: 0.85 }
        };
        const progSlow = {
            keys: [{ t: [0.2, 0.2], pos: [0.3, -0.5, 0.6] }],
            oscillate: { cycles: [4, 4], freq: [2.0, 2.0], ampDeg: [15, 15], decay: 0.85 }
        };

        const pFast = new ProgramPlayer(progFast, { deterministic: true });
        const pSlow = new ProgramPlayer(progSlow, { deterministic: true });

        const segFast = pFast.segments.find(s => s.name === 'OSC');
        const segSlow = pSlow.segments.find(s => s.name === 'OSC');

        expect(segFast).toBeDefined();
        expect(segSlow).toBeDefined();
        // 2 cycles / 4Hz = 0.5s duration vs 4 cycles / 2Hz = 2.0s duration
        expect(segFast.t1 - segFast.t0).toBeCloseTo(0.5, 2);
        expect(segSlow.t1 - segSlow.t0).toBeCloseTo(2.0, 2);
    });

    it('Procedural layer toggles actually toggle layer state', () => {
        const initialBody = isLayerEnabled('body');
        const toggledBody = toggleLayer('body');
        expect(toggledBody).toBe(!initialBody);
        expect(isLayerEnabled('body')).toBe(toggledBody);

        // Toggle back
        toggleLayer('body');
        expect(isLayerEnabled('body')).toBe(initialBody);
    });

    it('Dead snap property is completely purged from gesture library', () => {
        const lib = gestureLib.GESTURE_LIBRARY || gestureLib;
        for (const [name, prog] of Object.entries(lib)) {
            expect(prog.snap, `Program '${name}' should not have dead 'snap' property`).toBeUndefined();
        }
    });
});
