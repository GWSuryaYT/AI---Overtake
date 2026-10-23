// ═══════════════════════════════════════════════════
//  STUDIO POSE TOOLS — Copy/Paste/Reset/Mirror Pose
//  Works with normalized VRM humanoid bones.
// ═══════════════════════════════════════════════════

import * as THREE from 'three';
import { mirrorBoneName, mirrorQuaternion } from './clip_evaluator.js';
import { ALL_HUMANOID_BONES } from './studio_viewport.js';

const _q = new THREE.Quaternion();

/** Capture current bone rotations as a plain-object snapshot. */
export function capturePose(humanoid, boneNames = ALL_HUMANOID_BONES) {
    const pose = {};
    for (const name of boneNames) {
        const node = humanoid?.getNormalizedBoneNode(name);
        if (!node) continue;
        pose[name] = [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w];
    }
    return pose;
}

/** Apply a pose object to normalized bones. */
export function applyPose(humanoid, pose) {
    for (const [name, q] of Object.entries(pose)) {
        const node = humanoid?.getNormalizedBoneNode(name);
        if (!node) continue;
        node.quaternion.set(q[0], q[1], q[2], q[3]);
    }
}

/** Mirror a pose (left ↔ right, flipping Y and Z of quaternion). */
export function mirrorPose(pose) {
    const mirrored = {};
    for (const [name, q] of Object.entries(pose)) {
        const mName = mirrorBoneName(name);
        mirrored[mName] = mirrorQuaternion(q);
    }
    return mirrored;
}

/** Reset selected bones to identity rotation. */
export function resetBones(humanoid, boneNames) {
    for (const name of boneNames) {
        const node = humanoid?.getNormalizedBoneNode(name);
        if (node) node.quaternion.set(0, 0, 0, 1);
    }
}

/** Reset all humanoid bones to identity (T-pose). */
export function resetAllBones(humanoid) {
    resetBones(humanoid, ALL_HUMANOID_BONES);
}

/** Return a summary of which bones differ from identity by more than `threshold`. */
export function getModifiedBones(humanoid, threshold = 0.001) {
    const modified = [];
    for (const name of ALL_HUMANOID_BONES) {
        const node = humanoid?.getNormalizedBoneNode(name);
        if (!node) continue;
        const q = node.quaternion;
        const isIdentity = Math.abs(q.x) <= threshold && Math.abs(q.y) <= threshold &&
                           Math.abs(q.z) <= threshold && Math.abs(q.w - 1) <= threshold;
        if (!isIdentity) modified.push(name);
    }
    return modified;
}

// ── Pose Library (session-only; saved poses persist in localStorage) ──

const POSE_LIB_KEY = 'anna_studio_pose_library';

export function loadPoseLibrary() {
    try {
        const raw = localStorage.getItem(POSE_LIB_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

export function savePoseToLibrary(name, poseObj) {
    const lib = loadPoseLibrary();
    lib[name] = { name, createdAt: Date.now(), pose: poseObj };
    try { localStorage.setItem(POSE_LIB_KEY, JSON.stringify(lib)); } catch { }
    return lib;
}

export function deletePoseFromLibrary(name) {
    const lib = loadPoseLibrary();
    delete lib[name];
    try { localStorage.setItem(POSE_LIB_KEY, JSON.stringify(lib)); } catch { }
    return lib;
}
