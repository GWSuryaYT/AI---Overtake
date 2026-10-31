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
import { getCachedAssetUrl } from './avatar/asset_cache.js';

// ═══════════════════════════════════════════════════
//  GLOBALS
// ═══════════════════════════════════════════════════
let currentVrm = null;
let mixer = null;
let scene = null;
let camera = null;
let renderer3D = null;
let animFrameId = null;

// Avatar controllers
let speechFeatures = null;
let expressionController = null;
let gazeController = null;

const clock = new THREE.Clock();

// ── Animation state machine ──
let currentState = 'idle';
let currentActionName = null;
let isHandsFreeMode = typeof localStorage !== 'undefined' && localStorage.getItem('handsFreeMode') === 'true';

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

export function setHandsFreeModeState(enabled) {
    isHandsFreeMode = Boolean(enabled);
    if (isHandsFreeMode && (currentState === 'listening' || currentActionName === 'nodding')) {
        setAnimationState('idle');
    }
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
            if (isHandsFreeMode) {
                // In hands-free mode, keep character in idle instead of continuous nodding
                crossFadeTo('idle', 0.4);
            } else {
                crossFadeTo('nodding', 0.35);
            }
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
export function isVRMActive() {
    return Boolean(renderer3D);
}

export function initVRM() {
    if (renderer3D) {
        console.log("ℹ️ [Renderer] VRM scene is already active.");
        return;
    }

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        35,
        window.innerWidth / window.innerHeight,
        0.1,
        20.0
    );
    camera.position.set(0.0, 0.95, 3.5);
    camera.lookAt(0.0, 0.95, 0.0);

    renderer3D = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance'
    });
    renderer3D.setClearColor(0x000000, 0);
    renderer3D.setSize(window.innerWidth, window.innerHeight);
    renderer3D.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    document.getElementById('app').appendChild(renderer3D.domElement);

    // Lighting
    const light = new THREE.DirectionalLight(0xffffff, Math.PI);
    light.position.set(1.0, 1.0, 1.0).normalize();
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));

    // Load VRM Model (Wrapped with IndexedDB Cache)
    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

    getCachedAssetUrl('/models/avatar.vrm').then((cachedVrmUrl) => {
        gltfLoader.load(
            cachedVrmUrl,
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
    });

    // ── Load & retarget Mixamo FBX animations, stripping root-motion translation ──
    async function loadMixamoAnimation(url, name, loopMode = THREE.LoopRepeat) {
        const cachedUrl = await getCachedAssetUrl(url);
        const fbxLoader = new FBXLoader();
        fbxLoader.load(
            cachedUrl,
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

    // ── Dynamic Click-Through & Character-Dragging System ──
    let isDragging = false;
    let mouseStartX = 0;
    let mouseStartY = 0;
    let currentIgnoreState = true; // Start in pass-through mode
    let isOverCharacter = false;

    /**
     * Checks if a screen point hits any rendered character pixel (alpha > 5)
     */
    function isPointOnCharacter(clientX, clientY) {
        if (!renderer3D || !currentVrm) return false;
        try {
            const gl = renderer3D.getContext();
            if (gl) {
                const dpr = window.devicePixelRatio || 1;
                const x = Math.floor(clientX * dpr);
                const y = Math.floor((window.innerHeight - clientY) * dpr);
                const w = gl.drawingBufferWidth || Math.floor(window.innerWidth * dpr);
                const h = gl.drawingBufferHeight || Math.floor(window.innerHeight * dpr);

                if (x >= 0 && x < w && y >= 0 && y < h) {
                    const pixel = new Uint8Array(4);
                    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                    return pixel[3] > 5;
                }
            }
        } catch (err) {
            // Silently fall through
        }
        return false;
    }

    /**
     * Checks if a screen point is over interactive HTML UI elements (like settings)
     */
    function isPointOnUI(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        if (!el) return false;
        if (el === document.documentElement || el === document.body || el.id === 'app' || el.tagName === 'CANVAS') {
            return false;
        }
        return Boolean(
            el.closest('#settings-container') ||
            el.closest('.settings-panel') ||
            el.tagName === 'BUTTON' ||
            el.tagName === 'INPUT' ||
            el.tagName === 'SELECT' ||
            el.tagName === 'LABEL'
        );
    }

    /**
     * Safely updates the Electron click-through state without spamming IPC
     */
    function setIgnoreMouseEvents(ignore) {
        if (currentIgnoreState === ignore) return;
        currentIgnoreState = ignore;
        if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
            window.electronAPI.setIgnoreMouseEvents(ignore, { forward: true });
        }
    }

    // Mouse Move: detect hover and update pass-through / dragging
    window.addEventListener('mousemove', (e) => {
        if (!window.electronAPI) return;

        if (isDragging) {
            if (window.electronAPI && window.electronAPI.moveWindow) {
                window.electronAPI.moveWindow(e.screenX - mouseStartX, e.screenY - mouseStartY);
                mouseStartX = e.screenX;
                mouseStartY = e.screenY;
            }
            return;
        }

        const overUI = isPointOnUI(e.clientX, e.clientY);
        if (overUI) {
            isOverCharacter = false;
            document.body.style.cursor = 'default';
            setIgnoreMouseEvents(false);
            return;
        }

        isOverCharacter = isPointOnCharacter(e.clientX, e.clientY);
        if (isOverCharacter) {
            document.body.style.cursor = 'grab';
            setIgnoreMouseEvents(false);
        } else {
            document.body.style.cursor = 'default';
            setIgnoreMouseEvents(true);
        }
    });

    // Mouse Down: start drag ONLY when clicking on the character
    window.addEventListener('mousedown', (e) => {
        if (!window.electronAPI) return;
        if (e.button !== 0) return;

        // If clicking on UI, let UI handle it without dragging the window
        if (isPointOnUI(e.clientX, e.clientY)) {
            return;
        }

        // If clicking on character, begin window drag
        if (isPointOnCharacter(e.clientX, e.clientY)) {
            isDragging = true;
            mouseStartX = e.screenX;
            mouseStartY = e.screenY;
            document.body.style.cursor = 'grabbing';
            setIgnoreMouseEvents(false);
            e.preventDefault();
        }
    });

    // Mouse Up: release dragging
    window.addEventListener('mouseup', () => {
        if (!window.electronAPI) return;
        if (isDragging) {
            isDragging = false;
            document.body.style.cursor = isOverCharacter ? 'grab' : 'default';
            if (!isOverCharacter) {
                setIgnoreMouseEvents(true);
            }
        }
    });

    // Mouse Leave: restore pass-through when mouse exits the window
    window.addEventListener('mouseleave', () => {
        if (!window.electronAPI) return;
        if (!isDragging) {
            isOverCharacter = false;
            document.body.style.cursor = 'default';
            setIgnoreMouseEvents(true);
        }
    });

    // ── Resize ──
    window.addEventListener('resize', () => {
        resizeRenderer();
    });

    // ── Render loop ──
    function animate() {
        animFrameId = requestAnimationFrame(animate);
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

export function resizeRenderer() {
    if (!renderer3D || !camera) return;
    const appEl = document.getElementById('app');
    if (!appEl) return;

    const parent = appEl.parentElement;
    const isContained = parent && (parent.id === 'avatar-container' || parent.classList.contains('avatar-canvas-wrapper'));

    let width = window.innerWidth;
    let height = window.innerHeight;

    if (isContained) {
        width = parent.clientWidth || 360;
        height = parent.clientHeight || 380;
    }

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer3D.setSize(width, height);
}

export function setRemoteViewMode(container) {
    if (!container) return;
    const appEl = document.getElementById('app');
    if (appEl && appEl.parentElement !== container) {
        container.appendChild(appEl);
    }

    // Camera framing: Perfectly centers Anna's body inside the viewport card
    if (camera) {
        camera.position.set(0.0, 0.88, 2.75);
        camera.lookAt(0.0, 0.88, 0.0);
    }

    requestAnimationFrame(() => {
        resizeRenderer();
    });
}

/**
 * Cleanly teardown and dispose of the Three.js 3D VRM scene.
 * Immediately frees GPU memory, WebGL context, and animation CPU cycles.
 * Crucial for low-power mobile devices and older phones!
 */
export function stopVRM() {
    console.log("🛑 [Renderer] Stopping and releasing VRM 3D resources...");
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }

    if (mixer) {
        try {
            mixer.stopAllAction();
            mixer.uncacheRoot(mixer.getRoot());
        } catch (e) {}
        mixer = null;
    }

    if (currentVrm) {
        if (scene) scene.remove(currentVrm.scene);
        try {
            VRMUtils.removeUnusedVRM(currentVrm);
        } catch (e) {}
        currentVrm = null;
    }

    if (renderer3D) {
        try {
            if (renderer3D.domElement && renderer3D.domElement.parentElement) {
                renderer3D.domElement.parentElement.removeChild(renderer3D.domElement);
            }
            renderer3D.dispose();
            renderer3D.forceContextLoss();
        } catch (e) {}
        renderer3D = null;
    }

    scene = null;
    camera = null;
    speechFeatures = null;
    expressionController = null;
    gazeController = null;
    currentActionName = null;
    console.log("✓ [Renderer] VRM scene completely unloaded.");
}

/**
 * Allows external triggers (e.g. remote web buttons) to play gestures
 */
export function triggerAvatarAnimation(name) {
    if (!renderer3D || !currentVrm) {
        console.warn(`[Renderer] Cannot trigger '${name}': VRM not active.`);
        return false;
    }
    if (name === 'waving') {
        playOneShotAnimation('waving');
        return true;
    } else if (animationActions[name]) {
        crossFadeTo(name, 0.35);
        return true;
    }
    return false;
}

export { playOneShotAnimation, crossFadeTo };
