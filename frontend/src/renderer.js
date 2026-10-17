import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { retargetAnimation } from 'vrm-mixamo-retarget';
import { USE_PROCEDURAL_ENGINE, MAX_DT, EXPRESSION, GAZE } from './avatar/avatar_config.js';
import { isLayerEnabled } from './avatar/layers.js';
import { smoothFactor } from './avatar/springs.js';
import { SpeechFeatures } from './avatar/speech_features.js';
import { ExpressionController } from './avatar/expression_controller.js';
import { GazeController } from './avatar/gaze_controller.js';
import { BodyLayer } from './avatar/body_layer.js';
import { GestureEngine } from './avatar/gesture_engine.js';
import { ArmLayer } from './avatar/arm_layer.js';
import { clipLayer } from './avatar/clip_layer.js';
import { avatarFrame } from './avatar/frame.js';
import { rigSemantics } from './avatar/rig_semantics.js';
import { EMOTIONS, getEmotionConfig } from './avatar/emotion_map.js';
import { GESTURE_LIBRARY, GESTURE_MODES } from './avatar/gesture_library.js';

import { getAnalyser } from './audio_sync.js';

// ═══════════════════════════════════════════════════
//  GLOBALS
// ═══════════════════════════════════════════════════
let currentVrm = null;
let mixer = null;
let scene = null;   // kept for access in walking orchestrator
let camera = null;   // kept for resize
let renderer3D = null;   // kept for resize

// Procedural layer instances
let speechFeatures = null;
let expressionController = null;
let gazeController = null;
let bodyLayer = null;
let gestureEngine = null;
let armLayer = null;
let _debugModule = null;

const clock = new THREE.Clock();

// ── Animation state machine ──
// Core states: 'idle' | 'listening' | 'thinking' | 'speaking'
let currentState = 'idle';
let currentActionName = null;

const animationClips = {};
const animationActions = {};

// ── Lip sync ──
const currentLipSync = { a: 0, e: 0, i: 0, o: 0, u: 0 };
const targetLipSync = { a: 0, e: 0, i: 0, o: 0, u: 0 };

// ── Director state (shared with procedural engine) ──
const director = {
    animationState: 'idle',
    emotion: 'neutral',
    emotionIntensity: 0,
    emotionGaze: 'user',
    gestureMode: 'none',
    gazeTarget: 'user',
    isSpeaking: false,
    silenceTime: 0,
    rms: 0,
    fps: 0,
    applyCue: function(cue) {
        if (!cue) return;
        const isDevOrTest = (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') ||
                            (typeof import.meta !== 'undefined' && import.meta?.env?.DEV);

        if (cue.emotion) {
            if (!EMOTIONS[cue.emotion]) {
                const err = `[Director] Unknown emotion: "${cue.emotion}"`;
                if (isDevOrTest) throw new Error(err);
                console.error(err);
                return;
            }
            this.emotion = cue.emotion;
            this.emotionIntensity = cue.intensity || 1.0;
            this.silenceTime = 0;

            const emoConfig = getEmotionConfig(cue.emotion);
            if (!cue.gesture && emoConfig.defaultGesture) {
                this.gestureMode = emoConfig.defaultGesture;
            }
            if (!cue.gaze && emoConfig.gaze) {
                this.emotionGaze = emoConfig.gaze;
                if (gazeController) {
                    gazeController.setMode(emoConfig.gaze);
                }
            }
            if (expressionController) {
                expressionController.setEmotion(cue.emotion, this.emotionIntensity);
            }
        }
        if (cue.gesture) {
            const isKnownGesture = (cue.gesture === 'none') ||
                !!GESTURE_LIBRARY[cue.gesture] ||
                !!GESTURE_MODES[cue.gesture] ||
                (typeof _registeredClips !== 'undefined' && !!_registeredClips[cue.gesture]);
            if (!isKnownGesture) {
                const err = `[Director] Unknown gesture: "${cue.gesture}"`;
                if (isDevOrTest) throw new Error(err);
                console.error(err);
                return;
            }
            this.gestureMode = cue.gesture;
            if (gestureEngine) {
                if (cue.gesture === 'none') {
                    gestureEngine.resetToIdle();
                } else {
                    gestureEngine.trigger(cue.gesture, (this.emotionIntensity || 0.5) * 0.8 + 0.2);
                }
            }
        }
        if (cue.gaze) {
            const isKnownGaze = (cue.gaze === 'user') || (GAZE.TARGETS && !!GAZE.TARGETS[cue.gaze]);
            if (!isKnownGaze) {
                const err = `[Director] Unknown gaze target: "${cue.gaze}"`;
                if (isDevOrTest) throw new Error(err);
                console.error(err);
                return;
            }
            this.gazeTarget = cue.gaze;
            if (gazeController) {
                gazeController.setMode(cue.gaze);
            }
        }
        console.log('[Director] Cue applied:', cue);
    },

};

// ── FPS tracking ──
let _frameCount = 0;
let _fpsAccum = 0;

// ── Model report ──
let _modelReport = null;

// ═══════════════════════════════════════════════════
//  ANIMATION STATE MACHINE
// ═══════════════════════════════════════════════════
export function getCurrentAnimationState() {
    return currentState;
}

export function setAnimationState(newState) {
    if (newState === currentState) return;
    currentState = newState;
    director.animationState = newState;
    console.log(`[Anim] State → ${newState}`);

    if (USE_PROCEDURAL_ENGINE) {
        // Under procedural engine, states map to director behaviour:
        // - 'speaking' → enable gestures, set isSpeaking
        // - 'listening' → look at user, backchannel nods
        // - 'thinking' → gaze up-left, think posture
        // - 'idle' → relaxed
        director.isSpeaking = (newState === 'speaking');
        // Still crossfade to idle FBX as base layer
        if (newState === 'idle' || newState === 'listening' || newState === 'thinking') {
            crossFadeTo('idle');
        } else if (newState === 'speaking') {
            crossFadeTo('idle'); // base layer stays idle; gestures are procedural
        }
        return;
    }

    // Legacy FBX behaviour
    switch (newState) {
        case 'listening':
            crossFadeTo('nodding');
            break;
        case 'waving':
            crossFadeTo('waving');
            break;
        case 'thinking':
            crossFadeTo('thinking');
            break;
        case 'speaking':
            crossFadeTo('talking');
            break;
        case 'idle':
        default:
            crossFadeTo('idle');
            break;
    }
}

function crossFadeTo(name) {
    if (!mixer) return;
    if (name === currentActionName) return;

    const target = animationActions[name];
    if (!target) {
        console.warn(`[Anim] crossFadeTo('${name}'): not loaded yet`);
        return;
    }

    Object.values(animationActions).forEach((action) => {
        if (action !== target && action.isRunning()) {
            action.fadeOut(0.4);
        }
    });

    target.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.4).play();
    currentActionName = name;
}

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════
export function initVRM() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        35,
        window.innerWidth / window.innerHeight,
        0.1,
        20.0
    );
    camera.position.set(0.0, 0.95, 3.5);
    camera.lookAt(0.0, 0.95, 0.0);

    renderer3D = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer3D.setClearColor(0x000000, 0);
    renderer3D.setSize(window.innerWidth, window.innerHeight);
    renderer3D.setPixelRatio(window.devicePixelRatio);
    document.getElementById('app').appendChild(renderer3D.domElement);

    // Lighting
    const light = new THREE.DirectionalLight(0xffffff, Math.PI);
    light.position.set(1.0, 1.0, 1.0).normalize();
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    // Load VRM
    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

    gltfLoader.load(
        '/models/avatar.vrm',
        (gltf) => {
            const vrm = gltf.userData.vrm;

            if (currentVrm) {
                scene.remove(currentVrm.scene);
                VRMUtils.removeUnusedVRM(currentVrm);
            }

            currentVrm = vrm;
            scene.add(vrm.scene);
            VRMUtils.rotateVRM0(vrm);
            vrm.scene.updateMatrixWorld(true);

            // ── Initialize Avatar Frame & Probe Rig Semantics ──
            avatarFrame.init(vrm);
            rigSemantics.probe(vrm);

            mixer = new THREE.AnimationMixer(vrm.scene);

            // ── Initialize Procedural Engine Layers ──
            speechFeatures = new SpeechFeatures(getAnalyser());
            expressionController = new ExpressionController(vrm);
            gazeController = new GazeController(vrm, camera);
            bodyLayer = new BodyLayer(vrm);
            gestureEngine = new GestureEngine();
            armLayer = new ArmLayer(vrm, gestureEngine);
            clipLayer.setVRM(vrm);

            // ── Dev-only Gesture Studio / Debug Workbench (Dynamic Import) ──
            const shouldLoadStudio = import.meta.env.DEV || (typeof window !== 'undefined' &&
                (window.location.search.includes('studio=1') || window.location.search.includes('debug=1') || window.location.search.includes('workbench=1')));

            if (shouldLoadStudio) {
                import('./avatar/debug_panel.js').then((mod) => {
                    _debugModule = mod;
                    mod.initDebug(director, scene, gestureEngine, armLayer, renderer3D, camera, vrm, clipLayer);
                }).catch(err => console.error('[Studio] Failed to load debug_panel:', err));
            }

            // ── Load all animations ──
            const anims = [
                { file: '/animations/Idle.fbx', name: 'idle', autoPlay: true },
                { file: '/animations/Thinking.fbx', name: 'thinking' },
                { file: '/animations/Waving.fbx', name: 'waving' },
                { file: '/animations/Talking.fbx', name: 'talking' },
                { file: '/animations/Head Nodding.fbx', name: 'nodding' },
            ];

            anims.forEach(({ file, name, autoPlay }) => {
                loadMixamoAnimation(file, name, !!autoPlay);
            });
        },
        (progress) => console.log('Loading model…', (100.0 * progress.loaded / progress.total).toFixed(1), '%'),
        (error) => console.error('VRM load error:', error)
    );

    // ── Load + retarget Mixamo FBX, strip root motion ──
    function loadMixamoAnimation(url, name, autoPlay = false) {
        const fbxLoader = new FBXLoader();
        fbxLoader.load(
            url,
            (fbx) => {
                try {
                    const clip = retargetAnimation(fbx, currentVrm);

                    // ── STRIP ALL ROOT MOTION ──
                    // After retargetAnimation(), VRM bone names don't contain
                    // "Hips" anymore — they use VRM node names. So the old
                    // selective filter never caught the teleporting tracks.
                    // Solution: remove ALL .position tracks. Walking animation
                    // looks correct from rotations alone. Our manual
                    // position.x in tickWalking() is the ONLY thing that
                    // should move the model.
                    clip.tracks = clip.tracks.filter((track) => {
                        return !track.name.endsWith('.position');
                    });

                    animationClips[name] = clip;

                    const action = mixer.clipAction(clip);
                    action.clampWhenFinished = false;
                    action.loop = THREE.LoopRepeat;
                    animationActions[name] = action;

                    if (autoPlay && name === 'idle') {
                        action.play();
                        currentActionName = 'idle';
                    }

                    console.log(`✓ Animation loaded: ${name} (${clip.tracks.length} tracks)`);
                } catch (err) {
                    console.error(`Retarget error (${name}):`, err);
                }
            },
            undefined,
            (err) => console.error(`FBX load error (${name}):`, err)
        );
    }

    // ── Drag to move window (disabled in studio mode) ──
    const isStudioMode = (typeof window !== 'undefined') &&
        (window.location.search.includes('studio=1') || window.location.search.includes('workbench=1'));

    let isDragging = false, mouseStartX = 0, mouseStartY = 0;

    renderer3D.domElement.addEventListener('mousedown', (e) => {
        if (isStudioMode) return;
        if (e.button === 0) { isDragging = true; mouseStartX = e.screenX; mouseStartY = e.screenY; }
    });
    window.addEventListener('mouseup', () => { isDragging = false; });
    window.addEventListener('mousemove', (e) => {
        if (isDragging && window.electronAPI) {
            window.electronAPI.moveWindow(e.screenX - mouseStartX, e.screenY - mouseStartY);
            mouseStartX = e.screenX;
            mouseStartY = e.screenY;
        }
    });

    // ── Resize ──
    window.addEventListener('resize', () => {
        const wrapper = document.getElementById('studio-viewport-canvas-wrapper');
        const w = (isStudioMode && wrapper) ? wrapper.clientWidth : window.innerWidth;
        const h = (isStudioMode && wrapper) ? wrapper.clientHeight : window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer3D.setSize(w, h);
    });

    // ── Render loop ──
    function animate() {
        requestAnimationFrame(animate);
        const rawDt = clock.getDelta();
        const dt = Math.min(rawDt, MAX_DT); // Clamp dt

        // FPS tracking
        _fpsAccum += rawDt;
        _frameCount++;
        if (_fpsAccum >= 0.5) {
            director.fps = _frameCount / _fpsAccum;
            _frameCount = 0;
            _fpsAccum = 0;
        }

        if (currentVrm) {
            // ═══════════════════════════════════════════
            //  Per-frame update order (spec section 8):
            //  1. mixer.update       — base FBX idle writes bone rotations
            //  2. speechFeatures     — rms, onsets, isSpeaking
            //  3. cueScheduler       — fires cues whose audio started
            //  4. director           — emotion springs, gesture mode, gaze target
            //  5. bodyLayer          — additive breath/sway/posture/head
            //  6. gazeController     — eye target, saccades, head/neck follow, blink timing
            //  7. gestureEngine      — per-hand phases → hand targets
            //  8. armLayer           — read animated pose, IK, slerp by w_arm, fingers
            //  9. expressionController — emotions (springs), blink, THEN lip-sync visemes last
            // 10. vrm.update         — copies normalized → raw bones, lookAt, springbones
            // 11. renderer.render
            // ═══════════════════════════════════════════

            // 1. Mixer (base animation)
            if (mixer) mixer.update(dt);

            if (USE_PROCEDURAL_ENGINE) {
                // 2. Speech features from audio analyser
                if (speechFeatures) {
                    if (!speechFeatures.analyser) {
                        speechFeatures.setAnalyser(getAnalyser());
                    }
                    speechFeatures.update(dt);
                    const feat = speechFeatures.getFeatures();
                    director.rms = feat.rms;
                    if (director.animationState === 'speaking') {
                        director.isSpeaking = true;
                    } else {
                        director.isSpeaking = feat.isSpeaking;
                    }
                }

                // Smooth exponential decay of emotion after speaking ends
                if (!director.isSpeaking) {
                    director.silenceTime += dt;
                    if (director.silenceTime > (EXPRESSION.DECAY_DELAY || 1.5)) {
                        const decayRate = Math.LN2 / (EXPRESSION.DECAY_HALFLIFE || 1.8);
                        director.emotionIntensity = Math.max(0, director.emotionIntensity * Math.exp(-decayRate * dt));
                        if (director.emotionIntensity < 0.05) {
                            director.emotion = 'neutral';
                            director.emotionIntensity = 0;
                            director.gestureMode = 'none';
                        }
                    }
                } else {
                    director.silenceTime = 0;
                }

                // 3. Body layer: additive posture, breathing, sway, speech nods
                if (bodyLayer && isLayerEnabled('body')) {
                    bodyLayer.update(dt, director, speechFeatures ? speechFeatures.getFeatures() : null);
                }

                // 4. Gaze controller: lookAt target, saccades, partial head/neck follow
                if (gazeController && isLayerEnabled('gaze')) {
                    gazeController.update(dt, director);
                    gazeController.applyHeadFollow();
                }

                // 5. Gesture engine: McNeill state machine
                if (gestureEngine && isLayerEnabled('gesture')) {
                    gestureEngine.update(dt, director, speechFeatures ? speechFeatures.getFeatures() : null);
                }

                // 5b. Clip layer: bone animation clips (runs before armLayer so keyed bones suppress IK)
                if (clipLayer && isLayerEnabled('clip')) {
                    clipLayer.update(dt);
                }

                // 6. Arm layer: analytical two-bone IK + finger curl blending
                if (armLayer && isLayerEnabled('arm')) {
                    armLayer.apply(dt);
                }

                // 7. Expression controller: spring-driven facial expressions, timer blink, lipsync
                if (expressionController && isLayerEnabled('expression')) {
                    expressionController.update(dt, director);
                }

                // 8. VRM update (copies normalized bones -> raw bones, lookAt, spring bones)
                currentVrm.update(dt);
            } else {
                // Legacy frame-rate dependent blink
                if (Math.random() < 0.008) {
                    currentVrm.expressionManager.setValue('blink', 1);
                } else {
                    const bv = currentVrm.expressionManager.getValue('blink');
                    if (bv > 0) currentVrm.expressionManager.setValue('blink', Math.max(0, bv - 0.15));
                }

                // Lip sync smoothing — frame-rate independent
                const lf = smoothFactor(EXPRESSION.LIPSYNC_SMOOTH_SPEED, dt);
                currentLipSync.a += (targetLipSync.a - currentLipSync.a) * lf;
                currentLipSync.e += (targetLipSync.e - currentLipSync.e) * lf;
                currentLipSync.i += (targetLipSync.i - currentLipSync.i) * lf;
                currentLipSync.o += (targetLipSync.o - currentLipSync.o) * lf;
                currentLipSync.u += (targetLipSync.u - currentLipSync.u) * lf;

                currentVrm.expressionManager.setValue('aa', currentLipSync.a);
                currentVrm.expressionManager.setValue('ee', currentLipSync.e);
                currentVrm.expressionManager.setValue('ih', currentLipSync.i);
                currentVrm.expressionManager.setValue('oh', currentLipSync.o);
                currentVrm.expressionManager.setValue('ou', currentLipSync.u);

                // 10. VRM update (copies normalized → raw bones, lookAt, springbones)
                currentVrm.update(dt);
            }
        }

        // 11. Render
        renderer3D.render(scene, camera);

        // Debug overlay & 3D IK gizmos
        if (_debugModule) {
            _debugModule.updateDebugOverlay(director, gestureEngine, armLayer);
        }
    }

    animate();
}

// ═══════════════════════════════════════════════════
//  TIMER-BASED BLINK (Phase 0 interim — replaced in Phase 2)
// ═══════════════════════════════════════════════════
let _blinkTimer = 2.0 + Math.random() * 4.0; // initial random interval
let _blinkPhase = 'waiting'; // 'waiting' | 'closing' | 'opening'
let _blinkProgress = 0;
const _BLINK_CLOSE_DURATION = 0.06;
const _BLINK_OPEN_DURATION = 0.12;

function _updateBlinkTimer(dt) {
    if (!currentVrm) return;

    switch (_blinkPhase) {
        case 'waiting':
            _blinkTimer -= dt;
            if (_blinkTimer <= 0) {
                _blinkPhase = 'closing';
                _blinkProgress = 0;
            }
            break;
        case 'closing':
            _blinkProgress += dt / _BLINK_CLOSE_DURATION;
            if (_blinkProgress >= 1) {
                _blinkProgress = 1;
                _blinkPhase = 'opening';
            }
            currentVrm.expressionManager.setValue('blink', _blinkProgress);
            break;
        case 'opening':
            _blinkProgress -= dt / _BLINK_OPEN_DURATION;
            if (_blinkProgress <= 0) {
                _blinkProgress = 0;
                _blinkPhase = 'waiting';
                // Randomize next interval (2-6s, roughly gaussian via sum of two uniforms)
                _blinkTimer = 1.0 + Math.random() * 2.5 + Math.random() * 2.5;
            }
            currentVrm.expressionManager.setValue('blink', _blinkProgress);
            break;
    }
}

// ═══════════════════════════════════════════════════
//  PUBLIC LIP SYNC API
// ═══════════════════════════════════════════════════
export function setLipSyncPhonemes(phonemes) {
    if (!currentVrm) return;
    targetLipSync.a = phonemes.a || 0;
    targetLipSync.e = phonemes.e || 0;
    targetLipSync.i = phonemes.i || 0;
    targetLipSync.o = phonemes.o || 0;
    targetLipSync.u = phonemes.u || 0;
    if (expressionController) {
        expressionController.setLipSync(phonemes);
    }
}

// ═══════════════════════════════════════════════════
//  EXPORTS FOR PROCEDURAL ENGINE INTEGRATION
// ═══════════════════════════════════════════════════
export function getDirector() { return director; }
export function getVRM() { return currentVrm; }
export function getMixer() { return mixer; }
export function getCamera() { return camera; }
export function getScene() { return scene; }
