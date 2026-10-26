import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { retargetAnimation } from 'vrm-mixamo-retarget';
import { MAX_DT, EXPRESSION, GAZE } from './avatar/avatar_config.js';
import { SpeechFeatures } from './avatar/speech_features.js';
import { ExpressionController } from './avatar/expression_controller.js';
import { GazeController } from './avatar/gaze_controller.js';
import { avatarFrame } from './avatar/frame.js';
import { EMOTIONS, getEmotionConfig } from './avatar/emotion_map.js';
import { getAnalyser } from './audio_sync.js';

// ═══════════════════════════════════════════════════
//  GLOBALS
// ═══════════════════════════════════════════════════
let currentVrm = null;
let mixer = null;
let scene = null;
let camera = null;
let renderer3D = null;

// Avatar controllers
let speechFeatures = null;
let expressionController = null;
let gazeController = null;

const clock = new THREE.Clock();

// ── Animation state machine ──
let currentState = 'idle';
let currentActionName = null;

const animationClips = {};
const animationActions = {};

// Configurable animation presets from public/animations
// Users can easily add new FBX animations to this array!
const ANIMATION_DEFS = [
    { name: 'idle', file: '/animations/Idle.fbx', loop: THREE.LoopRepeat },
    { name: 'thinking', file: '/animations/Thinking.fbx', loop: THREE.LoopRepeat },
    { name: 'talking', file: '/animations/Talking.fbx', loop: THREE.LoopRepeat },
    { name: 'waving', file: '/animations/Waving.fbx', loop: THREE.LoopOnce },
    { name: 'nodding', file: '/animations/Head Nodding.fbx', loop: THREE.LoopRepeat },
];

// ── Lip sync ──
const currentLipSync = { a: 0, e: 0, i: 0, o: 0, u: 0 };
const targetLipSync = { a: 0, e: 0, i: 0, o: 0, u: 0 };

// ── Director state (shared with speech & cues) ──
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

        // 1. Emotion cue
        if (cue.emotion) {
            const emoName = cue.emotion.toLowerCase();
            if (EMOTIONS[emoName]) {
                this.emotion = emoName;
                this.emotionIntensity = cue.intensity || 1.0;
                this.silenceTime = 0;

                const emoConfig = getEmotionConfig(emoName);
                if (!cue.gaze && emoConfig.gaze) {
                    this.emotionGaze = emoConfig.gaze;
                    if (gazeController) {
                        gazeController.setMode(emoConfig.gaze);
                    }
                }
                if (expressionController) {
                    expressionController.setEmotion(emoName, this.emotionIntensity);
                }
            } else {
                console.warn(`[Director] Unknown emotion: "${cue.emotion}"`);
            }
        }

        // 2. Gaze cue
        if (cue.gaze) {
            this.gazeTarget = cue.gaze;
            if (gazeController) {
                gazeController.setMode(cue.gaze);
            }
        }

        // 3. Gesture / Animation cue
        if (cue.gesture) {
            const gest = cue.gesture.toLowerCase();
            this.gestureMode = gest;

            if (gest === 'talking_with_hands' || gest === 'talking' || gest === 'talk' || gest === 'explain' || gest === 'argue' || gest === 'gesturing') {
                crossFadeTo('talking', 0.35);
            } else if (gest === 'thinking' || gest === 'think' || gest === 'ponder') {
                crossFadeTo('thinking', 0.4);
            } else if (gest === 'waving' || gest === 'wave' || gest === 'hello') {
                playOneShotAnimation('waving');
            } else if (gest === 'nodding' || gest === 'nod' || gest === 'listen' || gest === 'listening') {
                crossFadeTo('nodding', 0.35);
            } else if (gest === 'none' || gest === 'idle') {
                crossFadeTo('idle', 0.4);
            } else if (animationActions[gest]) {
                // Any custom animation added by name
                crossFadeTo(gest, 0.35);
            }
        }

        console.log('[Director] Cue applied:', cue);
    },
};

// ── FPS tracking ──
let _frameCount = 0;
let _fpsAccum = 0;

// ═══════════════════════════════════════════════════
//  ANIMATION STATE MACHINE & CONTROLS
// ═══════════════════════════════════════════════════
export function getCurrentAnimationState() {
    return currentState;
}

export function setAnimationState(newState) {
    if (newState === currentState) return;
    currentState = newState;
    director.animationState = newState;
    console.log(`[Anim] State → ${newState}`);

    switch (newState) {
        case 'speaking':
            director.isSpeaking = true;
            // If the AI called talking with hands, switch to talking animation;
            // otherwise, stay in idle so the character speaks with emotion & lipsync!
            if (director.gestureMode === 'talking_with_hands' || director.gestureMode === 'talking' ||
                director.gestureMode === 'talk' || director.gestureMode === 'explain' || director.gestureMode === 'argue') {
                crossFadeTo('talking', 0.35);
            } else {
                // If currently in a one-shot or non-idle action, return to idle
                if (currentActionName !== 'talking' && currentActionName !== 'idle') {
                    crossFadeTo('idle', 0.35);
                }
            }
            break;

        case 'thinking':
            director.isSpeaking = false;
            crossFadeTo('thinking', 0.4);
            break;

        case 'listening':
            director.isSpeaking = false;
            crossFadeTo('nodding', 0.35);
            break;

        case 'waving':
            director.isSpeaking = false;
            playOneShotAnimation('waving');
            break;

        case 'idle':
        default:
            director.isSpeaking = false;
            director.gestureMode = 'none';
            crossFadeTo('idle', 0.4);
            break;
    }
}

/**
 * Crossfade smoothly to another animation by name.
 * @param {string} name
 * @param {number} [duration=0.4]
 */
function crossFadeTo(name, duration = 0.4) {
    if (!mixer) return;
    if (name === currentActionName) return;

    const target = animationActions[name];
    if (!target) {
        console.warn(`[Anim] crossFadeTo('${name}'): animation not loaded yet`);
        return;
    }

    // Reset target timeScale and ensure running
    target.reset();
    target.setEffectiveTimeScale(1);
    target.setEffectiveWeight(1);
    target.fadeIn(duration).play();

    // Fade out previous action
    if (currentActionName && animationActions[currentActionName]) {
        animationActions[currentActionName].fadeOut(duration);
    }

    currentActionName = name;
}

/**
 * Play an animation once and return to idle.
 * @param {string} name
 */
function playOneShotAnimation(name) {
    if (!mixer) return;
    const target = animationActions[name];
    if (!target) return;

    target.reset();
    target.setLoop(THREE.LoopOnce, 1);
    target.clampWhenFinished = true;
    target.setEffectiveTimeScale(1);
    target.setEffectiveWeight(1);
    target.fadeIn(0.25).play();

    if (currentActionName && animationActions[currentActionName] && currentActionName !== name) {
        animationActions[currentActionName].fadeOut(0.25);
    }
    currentActionName = name;
}

// ═══════════════════════════════════════════════════
//  INIT VRM & SCENE
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
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));

    // Load VRM Model
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

            // Calibrate avatar frame for directional gaze
            avatarFrame.init(vrm);

            mixer = new THREE.AnimationMixer(vrm.scene);

            // Initialize controllers
            speechFeatures = new SpeechFeatures(getAnalyser());
            expressionController = new ExpressionController(vrm);
            gazeController = new GazeController(vrm, camera, scene);

            // Listen for one-shot animation finishes (e.g. waving)
            mixer.addEventListener('finished', (e) => {
                if (e.action === animationActions['waving']) {
                    crossFadeTo('idle', 0.4);
                }
            });

            // Load all preset FBX animations
            ANIMATION_DEFS.forEach(({ file, name, loop }) => {
                loadMixamoAnimation(file, name, loop);
            });
        },
        (progress) => console.log('Loading model…', (100.0 * progress.loaded / progress.total).toFixed(1), '%'),
        (error) => console.error('VRM load error:', error)
    );

    // ── Load & retarget Mixamo FBX animations, stripping root-motion translation ──
    function loadMixamoAnimation(url, name, loopMode = THREE.LoopRepeat) {
        const fbxLoader = new FBXLoader();
        fbxLoader.load(
            url,
            (fbx) => {
                try {
                    const clip = retargetAnimation(fbx, currentVrm);

                    // Strip position tracks so model stays grounded at origin without drifting
                    clip.tracks = clip.tracks.filter((track) => !track.name.endsWith('.position'));

                    animationClips[name] = clip;

                    const action = mixer.clipAction(clip);
                    action.loop = loopMode;
                    action.clampWhenFinished = (loopMode === THREE.LoopOnce);
                    animationActions[name] = action;

                    if (name === 'idle') {
                        action.play();
                        currentActionName = 'idle';
                    }

                    console.log(`✓ Animation loaded: ${name} (${clip.tracks.length} tracks, ${clip.duration.toFixed(2)}s)`);
                } catch (err) {
                    console.error(`Retarget error (${name}):`, err);
                }
            },
            undefined,
            (err) => console.error(`FBX load error (${name}):`, err)
        );
    }

    // ── Drag to move window ──
    let isDragging = false, mouseStartX = 0, mouseStartY = 0;

    renderer3D.domElement.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            isDragging = true;
            mouseStartX = e.screenX;
            mouseStartY = e.screenY;
        }
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
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer3D.setSize(window.innerWidth, window.innerHeight);
    });

    // ── Render loop ──
    function animate() {
        requestAnimationFrame(animate);
        const rawDt = clock.getDelta();
        const dt = Math.min(rawDt, MAX_DT);

        // FPS tracking
        _fpsAccum += rawDt;
        _frameCount++;
        if (_fpsAccum >= 0.5) {
            director.fps = _frameCount / _fpsAccum;
            _frameCount = 0;
            _fpsAccum = 0;
        }

        if (currentVrm && mixer) {
            // 1. Mixer update (drives bones from active FBX clip)
            mixer.update(dt);

            // 2. Smart Animation Loop Windows:
            // (a) Thinking: Hand reaches head at ~1.65s (sample 50-55).
            // Gently ping-pong in [1.65s, 2.70s] so hand stays in thinking pose and stays alive!
            if (currentActionName === 'thinking') {
                const act = animationActions['thinking'];
                if (act && act.isRunning()) {
                    if (act.time >= 2.70 && act.timeScale > 0) {
                        act.timeScale = -0.7; // reverse gently
                    } else if (act.time <= 1.65 && act.timeScale < 0) {
                        act.timeScale = 0.7; // forward gently
                    }
                }
            }

            // (b) Talking: Active gesturing window is between ~2.2s and ~7.8s (sample 70 to 240).
            // Ping-pong within [2.2s, 7.8s] so hands stay up and actively gesturing without dropping!
            if (currentActionName === 'talking') {
                const act = animationActions['talking'];
                if (act && act.isRunning()) {
                    if (act.time >= 7.80 && act.timeScale > 0) {
                        act.timeScale = -0.85;
                    } else if (act.time <= 2.20 && act.timeScale < 0) {
                        act.timeScale = 0.85;
                    }
                }
            }

            // (c) Waving fallback: if finished waving, return to idle
            if (currentActionName === 'waving') {
                const act = animationActions['waving'];
                if (act && act.time >= act.getClip().duration - 0.08) {
                    crossFadeTo('idle', 0.4);
                }
            }

            // 3. Audio & Speech features
            if (speechFeatures) {
                if (!speechFeatures.analyser) {
                    speechFeatures.setAnalyser(getAnalyser());
                }
                speechFeatures.update(dt);
                const feat = speechFeatures.getFeatures();
                director.rms = feat.rms;
            }

            // 4. Smooth emotion decay after speech ends
            if (!director.isSpeaking) {
                director.silenceTime += dt;
                if (director.silenceTime > (EXPRESSION.DECAY_DELAY || 1.5)) {
                    const decayRate = Math.LN2 / (EXPRESSION.DECAY_HALFLIFE || 1.8);
                    director.emotionIntensity = Math.max(0, director.emotionIntensity * Math.exp(-decayRate * dt));
                    if (director.emotionIntensity < 0.05) {
                        director.emotion = 'neutral';
                        director.emotionIntensity = 0;
                    }
                }
            } else {
                director.silenceTime = 0;
            }

            // 5. Gaze controller (lookAt camera/user or target, natural micro-saccades, head follow)
            if (gazeController) {
                gazeController.update(dt, director);
                gazeController.applyHeadFollow();
            }

            // 6. Expression controller (spring-driven emotions, natural blink timer, lip-sync visemes)
            if (expressionController) {
                expressionController.update(dt, director);
            }

            // 7. VRM update (spring bones, VRM lookAt, mesh synchronization)
            currentVrm.update(dt);
        }

        // 8. Render Scene
        renderer3D.render(scene, camera);
    }

    animate();
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
//  PUBLIC EXPORTS
// ═══════════════════════════════════════════════════
export function getDirector() { return director; }
export function getVRM() { return currentVrm; }
export function getMixer() { return mixer; }
export function getCamera() { return camera; }
export function getScene() { return scene; }
