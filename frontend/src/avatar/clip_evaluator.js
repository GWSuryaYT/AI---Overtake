// ═══════════════════════════════════════════════════
//  CLIP EVALUATOR — Pure Track Evaluation, Quaternion Slerp,
//  and Mirroring for Blender-style Bone Clips
// ═══════════════════════════════════════════════════

import * as THREE from 'three';

const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qResult = new THREE.Quaternion();

/**
 * Smootherstep easing: 6t^5 - 15t^4 + 10t^3
 */
function smootherstep(t) {
    const c = Math.max(0, Math.min(1, t));
    return c * c * c * (c * (c * 6 - 15) + 10);
}

/**
 * Interpolate two quaternions given alpha and interpolation type.
 * @param {number[]} qA - [x, y, z, w]
 * @param {number[]} qB - [x, y, z, w]
 * @param {number} alpha - 0.0 to 1.0
 * @param {'smooth'|'linear'|'constant'} [interp='smooth']
 * @returns {number[]} [x, y, z, w]
 */
export function interpolateQuaternion(qA, qB, alpha, interp = 'smooth') {
    if (alpha <= 0) return [...qA];
    if (alpha >= 1) return [...qB];

    if (interp === 'constant') {
        return [...qA];
    }

    let easedAlpha = alpha;
    if (interp === 'smooth') {
        easedAlpha = smootherstep(alpha);
    }

    _qA.set(qA[0], qA[1], qA[2], qA[3]);
    _qB.set(qB[0], qB[1], qB[2], qB[3]);

    _qResult.copy(_qA).slerp(_qB, easedAlpha);
    return [_qResult.x, _qResult.y, _qResult.z, _qResult.w];
}

/**
 * Evaluate a single track at time t.
 * @param {Array<{t: number, rot?: number[], q?: number[], interp?: string}>} keys - Sorted by t
 * @param {number} t - Time in seconds
 * @returns {number[]|null} [x, y, z, w]
 */
export function evaluateClipTrack(keys, t) {
    if (!keys || keys.length === 0) return null;
    const getQ = (k) => k.rot || k.q;
    if (keys.length === 1 || t <= keys[0].t) {
        const q0 = getQ(keys[0]);
        return q0 ? [...q0] : null;
    }
    if (t >= keys[keys.length - 1].t) {
        const qLast = getQ(keys[keys.length - 1]);
        return qLast ? [...qLast] : null;
    }

    // Binary / linear search for bounding keys
    for (let i = 0; i < keys.length - 1; i++) {
        const k0 = keys[i];
        const k1 = keys[i + 1];
        if (t >= k0.t && t <= k1.t) {
            const span = k1.t - k0.t;
            const alpha = span > 0.00001 ? (t - k0.t) / span : 0;
            const interp = k0.interp || 'smooth';
            return interpolateQuaternion(getQ(k0), getQ(k1), alpha, interp);
        }
    }

    const qFinal = getQ(keys[keys.length - 1]);
    return qFinal ? [...qFinal] : null;
}

/**
 * Evaluate an entire clip at time t.
 * @param {object} clip - { name, duration, loop, tracks: { [bone]: [{t, rot, interp}] } }
 * @param {number} t - Time in seconds
 * @returns {{ [bone: string]: number[] }} Evaluated quaternions
 */
export function evaluateClip(clip, t) {
    if (!clip || !clip.tracks) return {};

    let localT = t;
    const dur = clip.duration || 1.0;

    if (clip.loop && dur > 0) {
        localT = ((t % dur) + dur) % dur;
    } else {
        localT = Math.max(0, Math.min(dur, t));
    }

    const pose = {};
    for (const [bone, keys] of Object.entries(clip.tracks)) {
        const q = evaluateClipTrack(keys, localT);
        if (q) pose[bone] = q;
    }
    return pose;
}

/**
 * Mirror bone name (swap left <-> right).
 * @param {string} boneName
 * @returns {string}
 */
export function mirrorBoneName(boneName) {
    if (boneName.startsWith('left')) {
        return 'right' + boneName.slice(4);
    }
    if (boneName.startsWith('right')) {
        return 'left' + boneName.slice(5);
    }
    return boneName;
}

/**
 * Reflect quaternion across body's sagittal YZ plane.
 * For normalized VRM humanoid bones: (x, -y, -z, w).
 * Double mirror returns the exact original quaternion.
 * @param {number[]} q - [x, y, z, w]
 * @returns {number[]} [x, -y, -z, w]
 */
export function mirrorQuaternion(q) {
    return [q[0], -q[1], -q[2], q[3]];
}

/**
 * Mirror an entire clip tracks map to the opposite side.
 * @param {object} clip
 * @returns {object} Mirrored clip
 */
export function mirrorClip(clip) {
    const mirrored = JSON.parse(JSON.stringify(clip));
    mirrored.name = (clip.name || 'clip') + '_mirrored';
    mirrored.tracks = {};

    for (const [bone, keys] of Object.entries(clip.tracks || {})) {
        const targetBone = mirrorBoneName(bone);
        mirrored.tracks[targetBone] = keys.map(k => ({
            t: k.t,
            rot: mirrorQuaternion(k.rot || k.q),
            interp: k.interp || 'smooth'
        }));
    }

    return mirrored;
}

/**
 * Validate a clip object.
 * @param {object} clip
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateClip(clip) {
    const errors = [];
    if (!clip || typeof clip !== 'object') {
        return { valid: false, errors: ['Clip must be an object'] };
    }
    if (!clip.name || typeof clip.name !== 'string') {
        errors.push('Clip requires a non-empty string name');
    }
    if (typeof clip.duration !== 'number' || clip.duration <= 0) {
        errors.push('Clip duration must be a positive number');
    }
    if (!clip.tracks || typeof clip.tracks !== 'object') {
        errors.push('Clip tracks must be an object');
    } else {
        for (const [bone, keys] of Object.entries(clip.tracks)) {
            if (!Array.isArray(keys)) {
                errors.push(`Track '${bone}' must be an array of keyframes`);
                continue;
            }
            let prevT = -1;
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (typeof k.t !== 'number' || k.t < 0) {
                    errors.push(`Track '${bone}' key ${i} has invalid time t: ${k.t}`);
                }
                if (k.t < prevT) {
                    errors.push(`Track '${bone}' key ${i} is not sorted chronologically`);
                }
                prevT = k.t;
                const q = k.rot || k.q;
                if (!Array.isArray(q) || q.length !== 4) {
                    errors.push(`Track '${bone}' key ${i} requires orientation rot/q: [x,y,z,w]`);
                }
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
