// ═══════════════════════════════════════════════════
//  BONE CLIPS & DOPE SHEET TEST SUITE
// ═══════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
    interpolateQuaternion,
    evaluateClipTrack,
    evaluateClip,
    mirrorBoneName,
    mirrorQuaternion,
    mirrorClip,
    validateClip
} from './clip_evaluator.js';
import { ClipLayer } from './clip_layer.js';

describe('Clip Evaluator & Quaternion Interpolation', () => {
    it('interpolates quaternions with constant, linear, and smooth easing', () => {
        const qA = [0, 0, 0, 1];
        const qB = [0, 0.7071068, 0, 0.7071068]; // 90 deg around Y

        // Constant: holds qA until 1.0
        const qConst0 = interpolateQuaternion(qA, qB, 0.0, 'constant');
        const qConst5 = interpolateQuaternion(qA, qB, 0.5, 'constant');
        const qConst1 = interpolateQuaternion(qA, qB, 1.0, 'constant');
        expect(qConst0).toEqual(qA);
        expect(qConst5).toEqual(qA);
        expect(qConst1[1]).toBeCloseTo(0.7071, 3);

        // Linear: slerp with raw alpha
        const qLin5 = interpolateQuaternion(qA, qB, 0.5, 'linear');
        // 45 deg around Y: sin(22.5 deg) ~ 0.38268, cos(22.5 deg) ~ 0.92388
        expect(qLin5[1]).toBeCloseTo(0.3827, 3);
        expect(qLin5[3]).toBeCloseTo(0.9239, 3);

        // Smooth: slerp with smootherstep(0.5) = 0.5 (symmetric), but eases at ends
        const qSmooth02 = interpolateQuaternion(qA, qB, 0.2, 'smooth');
        const qLin02 = interpolateQuaternion(qA, qB, 0.2, 'linear');
        // Smootherstep at 0.2 is < 0.2 (eased-in)
        expect(qSmooth02[1]).toBeLessThan(qLin02[1]);
    });

    it('evaluates clip track chronologically with boundary clamping', () => {
        const track = [
            { t: 0.0, rot: [0, 0, 0, 1], interp: 'smooth' },
            { t: 0.5, rot: [0.1, 0, 0, 0.995], interp: 'smooth' },
            { t: 1.0, rot: [0, 0, 0, 1], interp: 'smooth' }
        ];

        // Before start clamps to first key
        const qBefore = evaluateClipTrack(track, -0.5);
        expect(qBefore).toEqual([0, 0, 0, 1]);

        // Exact key hit
        const qMid = evaluateClipTrack(track, 0.5);
        expect(qMid[0]).toBeCloseTo(0.1, 4);
        expect(qMid[3]).toBeCloseTo(0.995, 4);

        // After end clamps to last key
        const qAfter = evaluateClipTrack(track, 1.5);
        expect(qAfter).toEqual([0, 0, 0, 1]);

        // Works with legacy 'q' property as well
        const trackWithQ = [
            { t: 0.0, q: [0, 0, 0, 1] },
            { t: 1.0, q: [0, 0.5, 0, 0.866] }
        ];
        const evaluated = evaluateClipTrack(trackWithQ, 0.5);
        expect(evaluated).not.toBeNull();
        expect(evaluated[1]).toBeGreaterThan(0.2);
    });

    it('evaluates entire clip and respects loop toggle', () => {
        const clip = {
            name: 'test_nod',
            duration: 1.0,
            loop: true,
            tracks: {
                head: [
                    { t: 0.0, rot: [0, 0, 0, 1] },
                    { t: 0.5, rot: [0.15, 0, 0, 0.988] },
                    { t: 1.0, rot: [0, 0, 0, 1] }
                ]
            }
        };

        // At t = 1.5, loop wraps to t = 0.5
        const poseLooped = evaluateClip(clip, 1.5);
        expect(poseLooped.head).toBeDefined();
        expect(poseLooped.head[0]).toBeCloseTo(0.15, 3);

        // Non-looping clip clamps at duration
        const nonLoopClip = { ...clip, loop: false };
        const poseClamped = evaluateClip(nonLoopClip, 1.5);
        expect(poseClamped.head[0]).toBeCloseTo(0.0, 3);
    });
});

describe('Sagittal YZ Plane Mirroring', () => {
    it('correctly maps symmetrical bone names across sagittal plane', () => {
        expect(mirrorBoneName('leftUpperArm')).toBe('rightUpperArm');
        expect(mirrorBoneName('rightUpperArm')).toBe('leftUpperArm');
        expect(mirrorBoneName('leftHand')).toBe('rightHand');
        expect(mirrorBoneName('rightIndexDistal')).toBe('leftIndexDistal');
        expect(mirrorBoneName('head')).toBe('head');
        expect(mirrorBoneName('spine')).toBe('spine');
        expect(mirrorBoneName('chest')).toBe('chest');
    });

    it('reflects quaternions across sagittal YZ plane and satisfies double-reflection identity', () => {
        // VRM normalized bone orientation reflection across body center: (x, -y, -z, w)
        const qOrig = [0.12, 0.34, -0.56, 0.75];
        const qMirrored = mirrorQuaternion(qOrig);
        expect(qMirrored).toEqual([0.12, -0.34, 0.56, 0.75]);

        // Double mirror returns exact original
        const qRoundTrip = mirrorQuaternion(qMirrored);
        expect(qRoundTrip).toEqual(qOrig);
    });

    it('mirrors an entire clip with track renaming and quaternion reflection', () => {
        const originalClip = {
            name: 'right_reach',
            duration: 1.0,
            tracks: {
                rightUpperArm: [
                    { t: 0.0, rot: [0.1, 0.2, 0.3, 0.9], interp: 'smooth' },
                    { t: 1.0, rot: [0.2, 0.3, 0.4, 0.8], interp: 'smooth' }
                ],
                head: [
                    { t: 0.0, rot: [0.05, 0.1, 0.0, 0.99], interp: 'smooth' }
                ]
            }
        };

        const mirrored = mirrorClip(originalClip);
        expect(mirrored.tracks.leftUpperArm).toBeDefined();
        expect(mirrored.tracks.rightUpperArm).toBeUndefined();
        expect(mirrored.tracks.head).toBeDefined();

        expect(mirrored.tracks.leftUpperArm[0].rot).toEqual([0.1, -0.2, -0.3, 0.9]);
        expect(mirrored.tracks.head[0].rot).toEqual([0.05, -0.1, -0.0, 0.99]);
    });
});

describe('Clip Format Validation', () => {
    it('accepts compliant canonical clip definition', () => {
        const validClip = {
            name: 'nod_curious',
            duration: 1.2,
            tracks: {
                head: [
                    { t: 0.0, rot: [0, 0, 0, 1], interp: 'smooth' },
                    { t: 0.4, rot: [0.08, 0.05, -0.02, 0.99], interp: 'smooth' },
                    { t: 1.2, rot: [0, 0, 0, 1], interp: 'smooth' }
                ]
            }
        };

        const result = validateClip(validClip);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('rejects invalid or malformed clips', () => {
        expect(validateClip(null).valid).toBe(false);
        expect(validateClip({ duration: 1.0 }).valid).toBe(false); // missing name
        expect(validateClip({ name: 'x', duration: -1 }).valid).toBe(false); // negative duration
        expect(validateClip({
            name: 'x',
            duration: 1.0,
            tracks: {
                head: [
                    { t: 0.5, rot: [0, 0, 0, 1] },
                    { t: 0.2, rot: [0, 0, 0, 1] } // non-chronological
                ]
            }
        }).valid).toBe(false);
        expect(validateClip({
            name: 'x',
            duration: 1.0,
            tracks: {
                head: [{ t: 0.0, rot: [0, 1] }] // invalid quaternion length
            }
        }).valid).toBe(false);
    });
});

describe('ClipLayer Runtime & Procedural IK Coordination', () => {
    let mockVRM;
    let clipLayer;

    beforeEach(() => {
        const mockBoneNodes = new Map();
        const getOrCreateBone = (name) => {
            if (!mockBoneNodes.has(name)) {
                mockBoneNodes.set(name, new THREE.Object3D());
            }
            return mockBoneNodes.get(name);
        };

        mockVRM = {
            humanoid: {
                getNormalizedBoneNode: (name) => getOrCreateBone(name)
            }
        };

        clipLayer = new ClipLayer(mockVRM);
    });

    it('registers and plays clips, suppressing IK for keyed arms', () => {
        const armClip = {
            name: 'right_point',
            duration: 1.0,
            tracks: {
                rightUpperArm: [
                    { t: 0.0, rot: [0, 0, 0, 1] },
                    { t: 1.0, rot: [0.2, 0, 0, 0.98] }
                ]
            }
        };

        clipLayer.registerClip(armClip.name, armClip);
        expect(clipLayer.getClip('right_point')).toBe(armClip);

        // Before play
        expect(clipLayer.isArmKeyed('right')).toBe(false);
        expect(clipLayer.isArmKeyed('left')).toBe(false);

        // Play right arm clip
        clipLayer.play('right_point', { instant: true, side: 'right' });
        expect(clipLayer.isArmKeyed('right')).toBe(true);
        expect(clipLayer.isArmKeyed('left')).toBe(false);

        // Stop clip
        clipLayer.stop(false);
        expect(clipLayer.isArmKeyed('right')).toBe(false);
    });

    it('correctly mirrors arm keys when played on opposite side', () => {
        const armClip = {
            name: 'right_reach',
            duration: 1.0,
            tracks: {
                rightUpperArm: [
                    { t: 0.0, rot: [0, 0, 0, 1] },
                    { t: 1.0, rot: [0, 0.3, 0, 0.95] }
                ]
            }
        };

        clipLayer.registerClip(armClip.name, armClip);

        // Play on left side with mirror
        clipLayer.play('right_reach', { instant: true, side: 'left', mirror: true });
        expect(clipLayer.isArmKeyed('left')).toBe(true);
        expect(clipLayer.isArmKeyed('right')).toBe(false);
    });

    it('handles holdUntilReleased and releases smoothly', () => {
        const holdClip = {
            name: 'hold_pose',
            duration: 0.5,
            holdUntilReleased: true,
            tracks: {
                head: [
                    { t: 0.0, rot: [0, 0, 0, 1] },
                    { t: 0.5, rot: [0.1, 0, 0, 0.99] }
                ]
            }
        };

        clipLayer.registerClip(holdClip.name, holdClip);
        clipLayer.play('hold_pose', { instant: true, holdUntilReleased: true });

        // Advance beyond duration
        clipLayer.update(1.0);
        expect(clipLayer.isPlaying).toBe(true);
        expect(clipLayer.currentTime).toBe(0.5); // held at end

        // Release
        clipLayer.release();
        expect(clipLayer.isReleased).toBe(true);
        expect(clipLayer.fadeState).toBe('out');
    });
});
