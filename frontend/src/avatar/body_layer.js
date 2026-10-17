// ═══════════════════════════════════════════════════
//  BODY LAYER (v2) — Posture, Breathing, Weight Shift, and Idle Life
//  Applies visible human amplitudes via rig semantics with bone drift guards
// ═══════════════════════════════════════════════════

import * as THREE from 'three';
import { simplex2 } from './noise.js';
import { smoothFactor } from './springs.js';
import { getEmotionConfig } from './emotion_map.js';
import { BODY } from './avatar_config.js';
import { defaultRNG } from './rng.js';
import { rigSemantics } from './rig_semantics.js';

// Preallocated scratch objects for zero GC per frame
const _qWork = new THREE.Quaternion();
const _eulerWork = new THREE.Euler(0, 0, 0, 'YXZ');

export class BodyLayer {
    /**
     * @param {object} vrm - VRM instance
     */
    constructor(vrm) {
        this.vrm = vrm;
        this.humanoid = vrm?.humanoid || null;

        // Cached normalized bone references
        this.bones = {
            hips: this.humanoid?.getNormalizedBoneNode('hips') || null,
            spine: this.humanoid?.getNormalizedBoneNode('spine') || null,
            chest: this.humanoid?.getNormalizedBoneNode('chest') || null,
            upperChest: this.humanoid?.getNormalizedBoneNode('upperChest') || null,
            neck: this.humanoid?.getNormalizedBoneNode('neck') || null,
            head: this.humanoid?.getNormalizedBoneNode('head') || null,
            leftShoulder: this.humanoid?.getNormalizedBoneNode('leftShoulder') || null,
            rightShoulder: this.humanoid?.getNormalizedBoneNode('rightShoulder') || null,
        };

        // Track animated bones from active clips to guard against drift
        this.animatedBones = new Set();

        // Timers and phase accumulators
        this.time = defaultRNG.range(0, 500);
        this.breathPhase = 0;

        // Speaking nod reaction spring
        this.speakingNodAngle = 0;
        this.speakingNodTarget = 0;

        // Listening backchannel timer
        this.backchannelTimer = defaultRNG.range(3.0, 6.0);
        this.backchannelNod = 0;

        // Smoothed posture targets from emotion
        this.posture = {
            headPitch: 0,
            headYaw: 0,
            headRoll: 0,
            spinePitch: 0,
            spineRoll: 0,
            shoulderRoll: 0,
        };
    }

    /**
     * Register which bones have tracks in the active animation clip.
     * Untracked bones will be reset to identity before applying additive layers.
     * @param {Set<string>|Array<string>} boneNames
     */
    setAnimatedBones(boneNames) {
        this.animatedBones = new Set(boneNames);
    }

    /**
     * Trigger a speech emphasis nod.
     * @param {number} strength [0, 1]
     */
    triggerSpeechNod(strength = 1.0) {
        // Spec: positive pitch = nose DOWN
        const nodRad = (BODY.SPEAKING_NOD_DEG || 2.5) * (Math.PI / 180) * strength;
        this.speakingNodTarget = nodRad;
    }

    /**
     * Update body layer state once per frame.
     * @param {number} dt - delta time in seconds
     * @param {object} director - director state
     * @param {object} [speechFeatures] - speech features { rms, onset, emphasis, isSpeaking }
     */
    update(dt, director, speechFeatures = null) {
        if (!this.humanoid) return;

        this.time += dt;

        // 1. Untracked Bone Drift Guard:
        // Only reset bones if animatedBones is explicitly provided, and never touch hips
        if (this.animatedBones.size > 0) {
            for (const [name, node] of Object.entries(this.bones)) {
                if (node && name !== 'hips' && !this.animatedBones.has(name)) {
                    node.quaternion.identity();
                }
            }
        }

        // 2. Emotion-derived posture targets
        const emotionName = director?.emotion || 'neutral';
        const emotionConfig = getEmotionConfig(emotionName);
        const emotionIntensity = director?.emotionIntensity || 1.0;

        const targetHeadPitch = (emotionConfig.headOffset?.pitch || 0) * emotionIntensity;
        const targetHeadYaw = (emotionConfig.headOffset?.yaw || 0) * emotionIntensity;
        const targetHeadRoll = (emotionConfig.headOffset?.roll || 0) * emotionIntensity;

        // Emotional spine & shoulder posture
        let targetSpinePitch = 0;
        let targetShoulderRoll = 0;
        if (emotionName === 'shy') {
            targetShoulderRoll = -0.035; // shoulders in
            targetSpinePitch = 0.025;   // slight forward slouch
        } else if (emotionName === 'angry') {
            targetSpinePitch = -0.03;   // chest out / forward
        } else if (emotionName === 'sad' || emotionName === 'sleepy') {
            targetSpinePitch = 0.04;    // slumped forward
        }

        // State-specific posture overrides
        if (director?.animationState === 'listening') {
            // Attentive tilt toward user
            this.posture.headRoll = 0.04;
        } else if (director?.animationState === 'thinking') {
            this.posture.headRoll = 0.06;
        }

        // Smooth posture transitions
        const postureK = smoothFactor(BODY.SWAY_SPEED || 3.0, dt);
        this.posture.headPitch += (targetHeadPitch - this.posture.headPitch) * postureK;
        this.posture.headYaw += (targetHeadYaw - this.posture.headYaw) * postureK;
        this.posture.headRoll += (targetHeadRoll - this.posture.headRoll) * postureK;
        this.posture.spinePitch += (targetSpinePitch - this.posture.spinePitch) * postureK;
        this.posture.shoulderRoll += (targetShoulderRoll - this.posture.shoulderRoll) * postureK;

        // 3. Breathing rhythm (arousal scales rate)
        const arousal = emotionConfig.arousal || 0.5;
        const breathRate = (BODY.BREATHE_RATE || 0.25) * (0.8 + arousal * 0.5);
        this.breathPhase += dt * breathRate * Math.PI * 2;
        const breathSin = Math.sin(this.breathPhase);

        // Visible breathing amplitude: chest 1-1.5° (0.02 rad), shoulder 0.8° (0.014 rad)
        const chestBreathRad = (BODY.BREATH_CHEST_DEG || 1.2) * (Math.PI / 180);
        const shoulderBreathRad = (BODY.BREATH_SHOULDER_DEG || 0.8) * (Math.PI / 180);

        const breathPitchChest = breathSin * chestBreathRad * (0.7 + arousal * 0.6);
        const breathShoulderLift = breathSin * shoulderBreathRad;

        // 4. Weight shift & sway (every 5-9s: spine/chest counter-rotation)
        const swayPeriod = 0.15; // ~6.6s cycle
        const swayX = simplex2(this.time * swayPeriod, 0) * 0.025; // 1.4°
        const swayY = simplex2(0, this.time * swayPeriod) * 0.020; // 1.1°

        // 5. Head idle micro-motion (±1.5-3° = 0.026 - 0.052 rad)
        const idleRad = (BODY.HEAD_IDLE_AMPLITUDE_DEG || 2.0) * (Math.PI / 180);
        const headMicroPitch = simplex2(this.time * 0.4, 10) * idleRad;
        const headMicroYaw = simplex2(10, this.time * 0.4) * idleRad;
        const headMicroRoll = simplex2(this.time * 0.3, 20) * (idleRad * 0.7);

        // 6. Speech nods
        if (speechFeatures && speechFeatures.onset) {
            this.triggerSpeechNod(speechFeatures.emphasis || 1.0);
        }
        const nodDecayK = smoothFactor(12.0, dt);
        this.speakingNodAngle += (this.speakingNodTarget - this.speakingNodAngle) * nodDecayK;
        this.speakingNodTarget *= Math.exp(-6.0 * dt);

        // 7. Listening backchannel nod
        if (director?.animationState === 'listening') {
            this.backchannelTimer -= dt;
            if (this.backchannelTimer <= 0) {
                const nodAngle = (BODY.LISTENING_NOD_DEG || 3.5) * (Math.PI / 180);
                this.backchannelNod = nodAngle;
                this.backchannelTimer = defaultRNG.range(2.5, 5.0);
            }
        }
        this.backchannelNod *= Math.exp(-5.0 * dt);

        // ═══════════════════════════════════════════════════
        //  APPLY ADDITIVE ROTATIONS VIA RIG SEMANTICS
        // ═══════════════════════════════════════════════════

        // Hips: Leave hips rotation completely to the base animation (Idle.fbx)
        // so legs remain naturally grounded on the floor without slanting.

        // Spine: posture + breath + subtle upper-body weight shift counter-rotation
        if (this.bones.spine) {
            _eulerWork.set(this.posture.spinePitch + breathPitchChest * 0.5, swayY * 0.4, swayX * 0.3, 'YXZ');
            _qWork.setFromEuler(_eulerWork);
            this.bones.spine.quaternion.multiply(_qWork);
        }

        // Chest / UpperChest: breathing expansion
        const chestNode = this.bones.upperChest || this.bones.chest;
        if (chestNode) {
            _eulerWork.set(breathPitchChest, 0, 0, 'YXZ');
            _qWork.setFromEuler(_eulerWork);
            chestNode.quaternion.multiply(_qWork);
        }

        // Shoulders: breathing lift + emotion hunch
        if (this.bones.leftShoulder) {
            rigSemantics.setShoulderLift('left', breathShoulderLift + this.posture.shoulderRoll);
        }
        if (this.bones.rightShoulder) {
            rigSemantics.setShoulderLift('right', breathShoulderLift + this.posture.shoulderRoll);
        }

        // Head: posture + idle micro-motion + speech nods + backchannel nod
        if (this.bones.head) {
            const totalHeadPitch = this.posture.headPitch + headMicroPitch +
                                   this.speakingNodAngle + this.backchannelNod;
            const totalHeadYaw = this.posture.headYaw + headMicroYaw;
            const totalHeadRoll = this.posture.headRoll + headMicroRoll;

            rigSemantics.setHeadAngles(totalHeadPitch, totalHeadYaw, totalHeadRoll);
        }
    }
}
