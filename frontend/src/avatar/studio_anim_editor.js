// ═══════════════════════════════════════════════════
//  STUDIO ANIMATION EDITOR
//  Blender-style: outliner (all bones), numeric panel,
//  I = insert key on selected bones, dope sheet, playback.
//  Replaces old "Bone Clips" sub-mode tab.
// ═══════════════════════════════════════════════════

import * as THREE from 'three';
import { evaluateClip, mirrorBoneName, mirrorQuaternion, validateClip } from './clip_evaluator.js';
import { ALL_HUMANOID_BONES } from './studio_viewport.js';
import {
    capturePose, applyPose, mirrorPose, resetBones, resetAllBones,
    getModifiedBones, loadPoseLibrary, savePoseToLibrary, deletePoseFromLibrary
} from './studio_pose_tools.js';

// ── Bone groups for the outliner ──
export const BONE_GROUPS = {
    'Head & Neck': ['head', 'neck', 'leftEye', 'rightEye'],
    'Spine': ['upperChest', 'chest', 'spine', 'hips'],
    'Left Arm': ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'],
    'Right Arm': ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'],
    'Left Fingers': [
        'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
        'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
        'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
        'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
        'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
    ],
    'Right Fingers': [
        'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
        'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
        'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
        'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
        'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
    ],
    'Left Leg': ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'],
    'Right Leg': ['rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'],
};

const _euler = new THREE.Euler(0, 0, 0, 'XYZ');
const _q = new THREE.Quaternion();
const RAD2DEG = THREE.MathUtils.radToDeg;
const DEG2RAD = THREE.MathUtils.degToRad;

// ── The main editor class ──

export class AnimEditor {
    /**
     * @param {{
     *   vrm: object,
     *   history: import('./studio_history.js').StudioHistory,
     *   clipLayer: import('./clip_layer.js').ClipLayer,
     *   skeletonOverlay: import('./studio_viewport.js').SkeletonOverlay,
     *   onClipChange: function,
     * }} opts
     */
    constructor(opts = {}) {
        this.vrm = opts.vrm || null;
        this.humanoid = opts.vrm?.humanoid || null;
        this.history = opts.history || null;
        this.clipLayer = opts.clipLayer || null;
        this.skeletonOverlay = opts.skeletonOverlay || null;
        this.onClipChange = opts.onClipChange || null;

        // Active clip being edited
        this.clip = {
            name: 'new_animation',
            duration: 2.0,
            loop: false,
            holdUntilReleased: false,
            tracks: {},      // { boneName: [{t, rot:[x,y,z,w], interp}] }
        };

        // Playback state
        this.playheadTime = 0.0;
        this.isPlaying = false;
        this._lastTime = null;
        this._rafId = null;

        // Auto-key
        this.autoKey = false;

        // Interpolation for new keys
        this.defaultInterp = 'smooth';

        // Selected bones (shared with SkeletonOverlay)
        this.selectedBones = new Set();

        // Outliner state
        this._collapsedGroups = new Set();

        // Clipboard for copy/paste
        this._clipboard = null;

        // Pose library
        this._poseLib = loadPoseLibrary();

        // Bound handlers
        this._onKeyDown = this._onKeyDown.bind(this);
        if (opts.enableShortcuts) {
            window.addEventListener('keydown', this._onKeyDown);
        }
    }

    setVRM(vrm) {
        this.vrm = vrm;
        this.humanoid = vrm?.humanoid || null;
    }

    setSelectedBones(boneSet) {
        this.selectedBones = boneSet instanceof Set ? boneSet : new Set(boneSet);
    }

    // ── Clip management ──────────────────────────────

    loadClip(clip) {
        this.clip = JSON.parse(JSON.stringify(clip));
        this.playheadTime = 0;
        this._applyAtTime(0);
        this.onClipChange?.();
    }

    newClip(name = 'new_animation', duration = 2.0) {
        this.clip = { name, duration, loop: false, holdUntilReleased: false, tracks: {} };
        this.playheadTime = 0;
        this.onClipChange?.();
    }

    // ── Keyframing ───────────────────────────────────

    /** Insert keyframe on all currently selected bones at playhead time. */
    insertKeyframe(boneNames = null, interp = null) {
        const bones = boneNames ?? [...this.selectedBones];
        if (bones.length === 0) return;
        const t = Math.round(this.playheadTime * 1000) / 1000;
        const _interp = interp || this.defaultInterp;

        for (const boneName of bones) {
            const node = this.humanoid?.getNormalizedBoneNode(boneName);
            if (!node) continue;

            const q = node.quaternion;
            const rot = [
                Math.round(q.x * 10000) / 10000,
                Math.round(q.y * 10000) / 10000,
                Math.round(q.z * 10000) / 10000,
                Math.round(q.w * 10000) / 10000,
            ];

            if (!this.clip.tracks[boneName]) this.clip.tracks[boneName] = [];
            const track = this.clip.tracks[boneName];
            const existIdx = track.findIndex(k => Math.abs(k.t - t) < 0.015);
            if (existIdx >= 0) {
                track[existIdx].rot = rot;
                track[existIdx].interp = _interp;
            } else {
                track.push({ t, rot, interp: _interp });
                track.sort((a, b) => a.t - b.t);
            }
            if (this.activeBoneRotations) {
                this.activeBoneRotations.delete(boneName);
            }
        }

        this.history?.push(this.clip, `Insert key at ${t.toFixed(2)}s`);
        this.onClipChange?.();
    }

    /** Delete keyframe on selected bones at (or near) playhead time. */
    deleteKeyframe(boneNames = null) {
        const bones = boneNames ?? [...this.selectedBones];
        const t = this.playheadTime;
        for (const boneName of bones) {
            const track = this.clip.tracks[boneName];
            if (!track) continue;
            const newTrack = track.filter(k => Math.abs(k.t - t) >= 0.015);
            if (newTrack.length === 0) delete this.clip.tracks[boneName];
            else this.clip.tracks[boneName] = newTrack;
        }
        this.history?.push(this.clip, `Delete key at ${t.toFixed(2)}s`);
        this.onClipChange?.();
    }

    /** Key all modified bones at current time. */
    keyModified() {
        const modified = getModifiedBones(this.humanoid);
        this.insertKeyframe(modified);
    }

    /** Key all selected bones at all existing keyframe times (bake). */
    bakeSelectedBones() {
        const times = new Set();
        Object.values(this.clip.tracks).forEach(keys => keys.forEach(k => times.add(k.t)));
        for (const t of [...times].sort((a, b) => a - b)) {
            this._applyAtTime(t);
            this.insertKeyframe([...this.selectedBones]);
        }
    }

    // ── Playback ─────────────────────────────────────

    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this._lastTime = performance.now();
        const tick = (now) => {
            if (!this.isPlaying) return;
            const dt = (now - this._lastTime) / 1000;
            this._lastTime = now;
            this.playheadTime += dt;
            const dur = this.clip.duration || 1.0;
            if (this.clip.loop) {
                this.playheadTime = ((this.playheadTime % dur) + dur) % dur;
            } else if (this.playheadTime >= dur) {
                this.playheadTime = dur;
                this.isPlaying = false;
            }
            this._applyAtTime(this.playheadTime);
            this.onClipChange?.();
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    }

    pause() {
        this.isPlaying = false;
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = null;
    }

    stop() {
        this.pause();
        this.seek(0);
    }

    seek(t) {
        this.playheadTime = Math.max(0, Math.min(this.clip.duration || 1.0, t));
        this._applyAtTime(this.playheadTime);
        this.onClipChange?.();
    }

    prevKeyframe() {
        const times = this._allKeyTimes().filter(t => t < this.playheadTime - 0.01);
        if (times.length > 0) this.seek(times[times.length - 1]);
    }

    nextKeyframe() {
        const times = this._allKeyTimes().filter(t => t > this.playheadTime + 0.01);
        if (times.length > 0) this.seek(times[0]);
    }

    _allKeyTimes() {
        const set = new Set();
        Object.values(this.clip.tracks).forEach(keys => keys.forEach(k => set.add(k.t)));
        return [...set].sort((a, b) => a - b);
    }

    _applyAtTime(t) {
        if (!this.humanoid) return;
        if (this.activeBoneRotations) {
            this.activeBoneRotations.clear();
        }
        const pose = evaluateClip(this.clip, t);
        for (const [boneName, rot] of Object.entries(pose)) {
            const node = this.humanoid.getNormalizedBoneNode(boneName);
            if (node) node.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
        }
    }

    // ── Pose copy/paste/mirror ────────────────────────

    copyPose() {
        if (!this.humanoid) return;
        const bones = this.selectedBones.size > 0 ? [...this.selectedBones] : ALL_HUMANOID_BONES;
        this._clipboard = capturePose(this.humanoid, bones);
    }

    pastePose() {
        if (!this._clipboard || !this.humanoid) return;
        applyPose(this.humanoid, this._clipboard);
        if (this.autoKey) this.insertKeyframe(Object.keys(this._clipboard));
    }

    pasteFlipped() {
        if (!this._clipboard || !this.humanoid) return;
        const flipped = mirrorPose(this._clipboard);
        applyPose(this.humanoid, flipped);
        if (this.autoKey) this.insertKeyframe(Object.keys(flipped));
    }

    mirrorActivePose() {
        if (!this.humanoid) return;
        const pose = capturePose(this.humanoid, ALL_HUMANOID_BONES);
        const flipped = mirrorPose(pose);
        applyPose(this.humanoid, flipped);
    }

    resetSelected() {
        if (!this.humanoid) return;
        const bones = this.selectedBones.size > 0 ? [...this.selectedBones] : ALL_HUMANOID_BONES;
        resetBones(this.humanoid, bones);
        if (this.autoKey) this.insertKeyframe(bones);
    }

    // ── Save / Load ──────────────────────────────────

    async saveClipToDisk() {
        const v = validateClip(this.clip);
        if (!v.valid) {
            alert('Clip validation errors:\n' + v.errors.join('\n'));
            return;
        }
        try {
            const res = await fetch('/__anna/save-clip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.clip),
            });
            const d = await res.json();
            if (d.success) {
                this.clipLayer?.registerClip(this.clip.name, this.clip);
                return true;
            } else {
                alert('Save error: ' + (d.error || 'Unknown'));
            }
        } catch (e) {
            alert('Save request failed: ' + e.message);
        }
        return false;
    }

    // ── Keyboard handler ─────────────────────────────

    _onKeyDown(e) {
        // Only handle when studio is open (debug panel active)
        const isInput = e.target.matches('input, textarea, select');
        if (isInput) return;

        // Alt+I = Delete key
        if ((e.key === 'i' || e.key === 'I') && e.altKey) {
            e.preventDefault();
            this.deleteKeyframe();
            return;
        }
        // I = Insert key
        if ((e.key === 'i' || e.key === 'I') && !e.altKey) {
            e.preventDefault();
            this.insertKeyframe();
            return;
        }
        // Space = Play/Pause
        if (e.code === 'Space') {
            e.preventDefault();
            this.isPlaying ? this.pause() : this.play();
        }
        // [ prev key, ] next key
        if (e.key === '[') { e.preventDefault(); this.prevKeyframe(); }
        if (e.key === ']') { e.preventDefault(); this.nextKeyframe(); }
    }

    dispose() {
        window.removeEventListener('keydown', this._onKeyDown);
        this.pause();
    }

    // ── Helpers: get bone rotation as Euler (degrees) ──

    getBoneEulerDeg(boneName) {
        if (!boneName) return { x: 0, y: 0, z: 0 };
        if (this.activeBoneRotations?.has(boneName)) {
            const q = this.activeBoneRotations.get(boneName);
            _euler.setFromQuaternion(q, 'XYZ');
            return {
                x: Math.round(RAD2DEG(_euler.x) * 10) / 10,
                y: Math.round(RAD2DEG(_euler.y) * 10) / 10,
                z: Math.round(RAD2DEG(_euler.z) * 10) / 10,
            };
        }
        const node = this.humanoid?.getNormalizedBoneNode(boneName);
        if (!node) return { x: 0, y: 0, z: 0 };
        _euler.setFromQuaternion(node.quaternion, 'XYZ');
        return {
            x: Math.round(RAD2DEG(_euler.x) * 10) / 10,
            y: Math.round(RAD2DEG(_euler.y) * 10) / 10,
            z: Math.round(RAD2DEG(_euler.z) * 10) / 10,
        };
    }

    setBoneEulerDeg(boneName, degX, degY, degZ) {
        if (!boneName) return;
        if (!this.activeBoneRotations) this.activeBoneRotations = new Map();
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(DEG2RAD(degX), DEG2RAD(degY), DEG2RAD(degZ), 'XYZ'));
        this.activeBoneRotations.set(boneName, q.clone());

        const node = this.humanoid?.getNormalizedBoneNode(boneName);
        if (node) {
            node.quaternion.copy(q);
        }
        if (this.autoKey) this.insertKeyframe([boneName]);
    }

    setBoneQuaternion(boneName, q) {
        if (!boneName || !q) return;
        if (!this.activeBoneRotations) this.activeBoneRotations = new Map();
        this.activeBoneRotations.set(boneName, q.clone());

        const node = this.humanoid?.getNormalizedBoneNode(boneName);
        if (node) {
            node.quaternion.copy(q);
        }
        if (this.autoKey) this.insertKeyframe([boneName]);
    }

    resetBone(boneName) {
        if (!boneName) return;
        if (this.activeBoneRotations) this.activeBoneRotations.delete(boneName);
        const node = this.humanoid?.getNormalizedBoneNode(boneName);
        if (node) {
            node.quaternion.set(0, 0, 0, 1);
        }
        if (this.autoKey) this.insertKeyframe([boneName]);
    }

    applyStudioBoneOverrides(humanoid) {
        const h = humanoid || this.humanoid;
        if (!h) return;

        // 1. If actively playing animation clip
        if (this.isPlaying) {
            const pose = evaluateClip(this.clip, this.playheadTime);
            for (const [boneName, rot] of Object.entries(pose)) {
                const node = h.getNormalizedBoneNode(boneName);
                if (node) node.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
            }
            return;
        }

        // 2. If paused, apply evaluated tracks from active clip at playhead time
        if (this.clip && this.clip.tracks && Object.keys(this.clip.tracks).length > 0) {
            const pose = evaluateClip(this.clip, this.playheadTime);
            for (const [boneName, rot] of Object.entries(pose)) {
                const node = h.getNormalizedBoneNode(boneName);
                if (node) node.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
            }
        }

        // 3. Apply live manual unkeyed / user Euler or gizmo rotations
        if (this.activeBoneRotations && this.activeBoneRotations.size > 0) {
            for (const [boneName, q] of this.activeBoneRotations.entries()) {
                const node = h.getNormalizedBoneNode(boneName);
                if (node) node.quaternion.copy(q);
            }
        }
    }
}
