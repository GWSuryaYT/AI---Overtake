// ═══════════════════════════════════════════════════
//  GAZE CONTROLLER (v2) — Realistic Eye & Head LookAt
//  Angular saccades (2-8°), camera eye contact, emotion-linked gaze
// ═══════════════════════════════════════════════════

import * as THREE from 'three';
import { smoothFactor } from './springs.js';
import { simplex2 } from './noise.js';
import { GAZE } from './avatar_config.js';
import { defaultRNG } from './rng.js';
import { rigSemantics } from './rig_semantics.js';
import { avatarFrame } from './frame.js';

// Preallocated scratch objects for zero GC per frame
const _vHeadWorld = new THREE.Vector3();
const _vCameraWorld = new THREE.Vector3();
const _vTargetAvatar = new THREE.Vector3();
const _vTargetWorld = new THREE.Vector3();
const _qHeadWork = new THREE.Quaternion();
const _qNeckWork = new THREE.Quaternion();
const _eulerWork = new THREE.Euler(0, 0, 0, 'YXZ');

export class GazeController {
    /**
     * @param {object} vrm - VRM instance
     * @param {THREE.Camera} [camera] - perspective camera for eye contact
     * @param {THREE.Scene} [worldScene] - world scene to parent target
     */
    constructor(vrm, camera = null, worldScene = null) {
        this.vrm = vrm;
        this.camera = camera;
        this.worldScene = worldScene || vrm?.scene?.parent || null;

        // Dedicated target Object3D for VRM lookAt
        this.targetObject = new THREE.Object3D();
        this.targetObject.name = 'AvatarGazeTarget';

        if (this.worldScene) {
            this.worldScene.add(this.targetObject);
        } else if (vrm && vrm.scene) {
            vrm.scene.add(this.targetObject);
        }

        if (vrm && vrm.lookAt) {
            vrm.lookAt.target = this.targetObject;
            vrm.lookAt.autoUpdate = true;
        }

        // Current target mode: 'user' | 'screen' | 'away' | 'down' | 'up_left' | 'up_right'
        this.mode = 'user';
        this.customOffset = new THREE.Vector3();

        // Target positions in world space
        this.currentTargetPos = new THREE.Vector3(0, 1.25, 2.5);
        this.desiredTargetPos = new THREE.Vector3(0, 1.25, 2.5);

        // Saccade state
        this.saccadeTimer = 1.0;
        this.saccadeOffset = new THREE.Vector3();

        this._noiseTime = defaultRNG.range(0, 500);

        // Head and neck follow angles (radians)
        this.headPitch = 0;
        this.headYaw = 0;
        this.neckPitch = 0;
        this.neckYaw = 0;
    }

    setCustomTarget(pos) {
        this.mode = 'custom';
        this.desiredTargetPos.copy(pos);
    }

    setMode(mode) {
        if (GAZE.TARGETS[mode] || mode === 'user') {
            this.mode = mode;
        } else {
            this.mode = 'user';
        }
    }

    /**
     * Update gaze target and compute head follow angles.
     * @param {number} dt - delta time
     * @param {object} [director] - director state
     */
    update(dt, director = null) {
        if (!this.vrm) return;

        this._noiseTime += dt;

        // 1. Check if director has gaze target or emotion default
        if (director && this.mode !== 'custom') {
            if (director.gazeTarget) {
                this.setMode(director.gazeTarget);
            } else if (director.emotionGaze) {
                this.setMode(director.emotionGaze);
            }
        }

        const headNode = this.vrm.humanoid?.getNormalizedBoneNode('head');
        if (headNode) {
            headNode.getWorldPosition(_vHeadWorld);
        } else {
            _vHeadWorld.set(0, 1.25, 0);
        }

        // 2. Angular Saccades (2-8° jumps every 0.4 - 2.5s)
        this.saccadeTimer -= dt;
        if (this.saccadeTimer <= 0) {
            const isSpeaking = director && director.isSpeaking;
            const minTime = isSpeaking ? (GAZE.SACCADE_MIN_INTERVAL || 0.4) : 0.8;
            const maxTime = isSpeaking ? 1.6 : (GAZE.SACCADE_MAX_INTERVAL || 2.5);
            this.saccadeTimer = defaultRNG.range(minTime, maxTime);

            // Angle in radians (2 to 8 degrees)
            const angleDeg = defaultRNG.range(GAZE.SACCADE_MIN_DEG || 2.0, GAZE.SACCADE_MAX_DEG || 7.0);
            const angleRad = angleDeg * (Math.PI / 180);
            const azimuth = defaultRNG.range(0, Math.PI * 2);

            // Compute displacement at distance ~1.5m
            const d = 1.5;
            this.saccadeOffset.set(
                Math.cos(azimuth) * Math.sin(angleRad) * d,
                Math.sin(azimuth) * Math.sin(angleRad) * d,
                0
            );
        }

        // Continuous micro-saccades (0.2 - 0.4°)
        const microDeg = (GAZE.MICROSACCADE_DEG || 0.35) * (Math.PI / 180) * 1.5;
        const driftX = simplex2(this._noiseTime * 1.2, 0) * microDeg;
        const driftY = simplex2(0, this._noiseTime * 1.2) * microDeg;

        // 3. Compute base target position in world space
        if (this.mode === 'custom') {
            // Custom target set externally
        } else if (this.mode === 'user' && this.camera) {
            // Eye contact with camera lens
            this.camera.getWorldPosition(_vCameraWorld);
            this.desiredTargetPos.copy(_vCameraWorld);
            // Slight natural dip toward user's face
            this.desiredTargetPos.y -= 0.05;
        } else {
            // Named avatar targets
            const offset = GAZE.TARGETS[this.mode] || GAZE.TARGETS.user;
            _vTargetAvatar.set(offset.x, offset.y, offset.z);
            avatarFrame.toWorld(_vTargetAvatar, _vTargetWorld);
            this.desiredTargetPos.copy(_vTargetWorld);
        }

        // Add saccade and micro-drift
        this.desiredTargetPos.x += this.saccadeOffset.x + driftX;
        this.desiredTargetPos.y += this.saccadeOffset.y + driftY;
        this.desiredTargetPos.z += this.saccadeOffset.z;
        this.desiredTargetPos.add(this.customOffset);

        // Smooth toward target
        const smoothK = smoothFactor(GAZE.TRACKING_SPEED || 8.0, dt);
        this.currentTargetPos.lerp(this.desiredTargetPos, smoothK);

        // Update targetObject position
        this.targetObject.position.copy(this.currentTargetPos);

        // 4. Compute partial head and neck follow
        // Compute direction vector from head to gaze target in world space
        const dx = this.currentTargetPos.x - _vHeadWorld.x;
        const dy = this.currentTargetPos.y - _vHeadWorld.y;
        const dz = this.currentTargetPos.z - _vHeadWorld.z;
        const distXZ = Math.max(0.1, Math.sqrt(dx * dx + dz * dz));

        // When target is to the avatar's left (+X in world), head yaws LEFT (+yaw)
        const rawYaw = Math.atan2(dx, Math.max(0.1, dz));
        // When target is above head (+Y), head pitches UP (negative pitch = nose up)
        const rawPitch = -Math.atan2(dy, distXZ);

        const headWeight = GAZE.HEAD_FOLLOW_WEIGHT || 0.30;
        const targetHeadYaw = rawYaw * headWeight;
        const targetHeadPitch = rawPitch * headWeight;

        const headSmooth = smoothFactor(4.0, dt);
        this.headYaw += (targetHeadYaw - this.headYaw) * headSmooth;
        this.headPitch += (targetHeadPitch - this.headPitch) * headSmooth;

        // Neck gets half the follow
        this.neckYaw = this.headYaw * (GAZE.NECK_FOLLOW_FACTOR || 0.15) / headWeight;
        this.neckPitch = this.headPitch * (GAZE.NECK_FOLLOW_FACTOR || 0.15) / headWeight;
    }

    /**
     * Apply additive rotation to head and neck normalized bones.
     * Reuses scratch objects for zero GC per frame.
     */
    applyHeadFollow() {
        if (!this.vrm || !this.vrm.humanoid) return;

        const headNode = this.vrm.humanoid.getNormalizedBoneNode('head');
        const neckNode = this.vrm.humanoid.getNormalizedBoneNode('neck');

        if (headNode) {
            _eulerWork.set(this.headPitch, this.headYaw, 0, 'YXZ');
            _qHeadWork.setFromEuler(_eulerWork);
            headNode.quaternion.multiply(_qHeadWork);
        }

        if (neckNode) {
            _eulerWork.set(this.neckPitch, this.neckYaw, 0, 'YXZ');
            _qNeckWork.setFromEuler(_eulerWork);
            neckNode.quaternion.multiply(_qNeckWork);
        }
    }
}
