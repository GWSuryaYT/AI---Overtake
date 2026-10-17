import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ProgramPlayer } from './program_player.js';
import { GestureEngine } from './gesture_engine.js';
import { GESTURE_LIBRARY } from './gesture_library.js';
import { avatarLandmarks } from './landmarks.js';

describe('ProgramPlayer & GestureEngine Core Tests', () => {
    it('ProgramPlayer is deterministic: same inputs -> identical output', () => {
        const prog = GESTURE_LIBRARY.wave;
        const p1 = new ProgramPlayer(prog, { seed: 42, deterministic: true, side: 'right' });
        const p2 = new ProgramPlayer(prog, { seed: 42, deterministic: true, side: 'right' });

        expect(p1.duration).toBeCloseTo(p2.duration, 5);
        expect(p1.segments.length).toBe(p2.segments.length);

        for (let t = 0; t <= p1.duration; t += 0.05) {
            const pose1 = p1.evaluate(t);
            const pose2 = p2.evaluate(t);
            expect(pose1.posU[0]).toBeCloseTo(pose2.posU[0], 5);
            expect(pose1.posU[1]).toBeCloseTo(pose2.posU[1], 5);
            expect(pose1.posU[2]).toBeCloseTo(pose2.posU[2], 5);
            expect(pose1.oscAngle).toBeCloseTo(pose2.oscAngle, 5);
            expect(pose1.weight).toBeCloseTo(pose2.weight, 5);
        }
    });

    it('Continuity: no jump larger than epsilon between t and t+1/120; segments cover [0, duration] with no gaps', () => {
        const prog = GESTURE_LIBRARY.wave;
        const player = new ProgramPlayer(prog, { seed: 12345, deterministic: true, side: 'right' });

        // Check segments cover [0, duration] with no gaps
        expect(player.segments[0].t0).toBe(0);
        for (let i = 0; i < player.segments.length - 1; i++) {
            expect(player.segments[i].t1).toBeCloseTo(player.segments[i + 1].t0, 5);
        }
        expect(player.segments[player.segments.length - 1].t1).toBeCloseTo(player.duration, 5);

        // Check continuity along trajectory (dt = 1/120 s)
        const dt = 1.0 / 120.0;
        let prevPose = player.evaluate(0);

        for (let t = dt; t <= player.duration; t += dt) {
            const pose = player.evaluate(t);
            const dx = Math.abs(pose.posU[0] - prevPose.posU[0]);
            const dy = Math.abs(pose.posU[1] - prevPose.posU[1]);
            const dz = Math.abs(pose.posU[2] - prevPose.posU[2]);
            const dw = Math.abs(pose.weight - prevPose.weight);

            // With smootherstep / smoothstep, max displacement per 1/120s is well below 0.15 U
            expect(dx).toBeLessThan(0.15);
            expect(dy).toBeLessThan(0.15);
            expect(dz).toBeLessThan(0.15);
            expect(dw).toBeLessThan(0.15);

            prevPose = pose;
        }
    });

    it('Pause at key N: wrist error to target is < 1 mm (0.001 U / meters)', () => {
        const prog = GESTURE_LIBRARY.emphasize; // Has 2 keys
        const player = new ProgramPlayer(prog, { seed: 100, deterministic: true, side: 'right' });

        // Key 0 peak
        const t0 = player.getKeyPeakTime(0);
        const pose0 = player.evaluate(t0);
        expect(pose0.posU[0]).toBeCloseTo(prog.keys[0].pos[0], 3);
        expect(pose0.posU[1]).toBeCloseTo(prog.keys[0].pos[1], 3);
        expect(pose0.posU[2]).toBeCloseTo(prog.keys[0].pos[2], 3);

        // Key 1 peak
        const t1 = player.getKeyPeakTime(1);
        const pose1 = player.evaluate(t1);
        expect(pose1.posU[0]).toBeCloseTo(prog.keys[1].pos[0], 3);
        expect(pose1.posU[1]).toBeCloseTo(prog.keys[1].pos[1], 3);
        expect(pose1.posU[2]).toBeCloseTo(prog.keys[1].pos[2], 3);
    });

    it('Pause at oscillation peak: oscAngle equals the max peak amplitude within 1%', () => {
        const prog = GESTURE_LIBRARY.wave;
        const player = new ProgramPlayer(prog, { seed: 999, deterministic: true, side: 'right' });

        const tPeak = player.getOscPeakTime();
        expect(tPeak).not.toBeNull();

        const poseAtPeak = player.evaluate(tPeak);
        const oscAngleAtPeak = poseAtPeak.oscAngle;

        // Sample finely around tPeak in OSC segment to verify it is within 1% of max
        let maxSampledAngle = 0;
        const oscSeg = player.segments.find(s => s.name === 'OSC');
        for (let t = oscSeg.t0; t <= oscSeg.t1; t += 0.001) {
            const angle = player.evaluate(t).oscAngle;
            if (angle > maxSampledAngle) {
                maxSampledAngle = angle;
            }
        }

        expect(oscAngleAtPeak).toBeGreaterThan(0);
        expect(Math.abs(oscAngleAtPeak - maxSampledAngle) / maxSampledAngle).toBeLessThan(0.01);
    });

    it('Bug 1 Regression: Fire -> Pause -> Fire -> Loop -> Reset never leaves engine stuck', () => {
        const engine = new GestureEngine();

        // 1. Fire
        engine.trigger('wave', 0.5, 'right', { force: true });
        expect(engine.isFrozen).toBe(false);
        engine.update(0.1, { isSpeaking: false });
        expect(engine.right.weight).toBeGreaterThan(0);

        // 2. Freeze / Pause
        engine.freeze(true);
        expect(engine.isFrozen).toBe(true);
        const frozenWeight = engine.right.weight;
        engine.update(0.1, { isSpeaking: false });
        expect(engine.isFrozen).toBe(true);

        // 3. Fire again (must unfreeze and play without Reset)
        engine.trigger('explain', 0.5, 'right', { force: true });
        expect(engine.isFrozen).toBe(false);
        engine.update(0.05, { isSpeaking: false });
        expect(engine.isFrozen).toBe(false);
        expect(engine.right.gestureName).toBe('explain');

        // 4. Loop (must not hang on frozen state)
        engine.freeze(true);
        expect(engine.isFrozen).toBe(true);
        engine.setLoop(true, 'wave', 'right');
        expect(engine.isFrozen).toBe(false);
        expect(engine.isLooping).toBe(true);

        // 5. Reset
        engine.resetToIdle();
        expect(engine.isFrozen).toBe(false);
        expect(engine.isLooping).toBe(false);
        expect(engine.right.phase).toBe('REST');
        expect(engine.right.weight).toBe(0);
    });

    it('Debug takeover: scrubbing while paused updates pose; auto-triggers ignored', () => {
        const engine = new GestureEngine();
        const prog = GESTURE_LIBRARY.wave;

        engine.debug.active = true;
        engine.debug.deterministic = true;
        engine.debug.program = prog;
        engine.debug.player = new ProgramPlayer(prog, { deterministic: true, side: 'right' });
        engine.debug.paused = true;
        engine.debug.handSel = 'right';

        // Scrub to t = 0.3s
        engine.debug.t = 0.3;
        engine.update(0.016, { isSpeaking: true, animationState: 'thinking', emotion: 'shy' }, { onset: true, emphasis: 1.0 });

        const expectedPose = engine.debug.player.evaluate(0.3);
        expect(engine.right.posU[0]).toBeCloseTo(expectedPose.posU[0], 4);
        expect(engine.right.posU[1]).toBeCloseTo(expectedPose.posU[1], 4);
        expect(engine.right.posU[2]).toBeCloseTo(expectedPose.posU[2], 4);
        expect(engine.right.weight).toBeCloseTo(expectedPose.weight, 4);

        // Should NOT have triggered think or shy
        expect(engine.right.gestureName).not.toBe('think');
        expect(engine.right.gestureName).not.toBe('shy');

        // Scrub to t = 0.6s
        engine.debug.t = 0.6;
        engine.update(0.016, { isSpeaking: true });
        const expectedPose2 = engine.debug.player.evaluate(0.6);
        expect(engine.right.posU[0]).toBeCloseTo(expectedPose2.posU[0], 4);
        expect(engine.right.posU[1]).toBeCloseTo(expectedPose2.posU[1], 4);
    });

    it('Left/right mirror: mirrored edit produces mirrored wrist world path within 2 mm', () => {
        const prog = GESTURE_LIBRARY.explain;
        const playerL = new ProgramPlayer(prog, { seed: 123, deterministic: true, side: 'left' });
        const playerR = new ProgramPlayer(prog, { seed: 123, deterministic: true, side: 'right' });

        const vL = new THREE.Vector3();
        const vR = new THREE.Vector3();

        for (let t = 0.1; t < playerL.duration - 0.1; t += 0.05) {
            const poseL = playerL.evaluate(t);
            const poseR = playerR.evaluate(t);

            avatarLandmarks.offsetToWorld('left', poseL.posU, vL);
            avatarLandmarks.offsetToWorld('right', poseR.posU, vR);

            // Left and right shoulders are symmetric across X=0 in avatar local space
            // OffsetToWorld mirrors X coordinate for right arm vs left arm
            const distFromMidX_L = Math.abs(vL.x - avatarLandmarks.midShoulder.x);
            const distFromMidX_R = Math.abs(vR.x - avatarLandmarks.midShoulder.x);

            expect(Math.abs(distFromMidX_L - distFromMidX_R)).toBeLessThan(0.002); // within 2mm
            expect(Math.abs(vL.y - vR.y)).toBeLessThan(0.002); // same height within 2mm
            expect(Math.abs(vL.z - vR.z)).toBeLessThan(0.002); // same depth within 2mm
        }
    });
});
