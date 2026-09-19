import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { retargetAnimation } from 'vrm-mixamo-retarget';

// ═══════════════════════════════════════════════════
//  GLOBALS
// ═══════════════════════════════════════════════════
let currentVrm = null;
let mixer = null;
let scene = null;   // kept for access in walking orchestrator
let camera = null;   // kept for resize
let renderer3D = null;   // kept for resize

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

// ═══════════════════════════════════════════════════
//  ANIMATION STATE MACHINE
// ═══════════════════════════════════════════════════
export function setAnimationState(newState) {
    if (newState === currentState) return;
    currentState = newState;
    console.log(`[Anim] State → ${newState}`);

    switch (newState) {
        case 'listening':
            crossFadeTo('waving');
            break;
        case 'thinking':
            crossFadeTo('thinking');
            break;
        case 'speaking':
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

            mixer = new THREE.AnimationMixer(vrm.scene);

            // ── Load all animations ──
            const anims = [
                { file: '/animations/Idle.fbx', name: 'idle', autoPlay: true },
                { file: '/animations/Thinking.fbx', name: 'thinking' },
                { file: '/animations/Waving.fbx', name: 'waving' },
                { file: '/animations/Talking.fbx', name: 'talking' },
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

    // ── Drag to move window ──
    let isDragging = false, mouseStartX = 0, mouseStartY = 0;

    renderer3D.domElement.addEventListener('mousedown', (e) => {
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
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer3D.setSize(window.innerWidth, window.innerHeight);
    });

    // ── Render loop ──
    function animate() {
        requestAnimationFrame(animate);
        const dt = clock.getDelta();

        if (currentVrm) {
            // Blinking
            if (Math.random() < 0.008) {
                currentVrm.expressionManager.setValue('blink', 1);
            } else {
                const bv = currentVrm.expressionManager.getValue('blink');
                if (bv > 0) currentVrm.expressionManager.setValue('blink', Math.max(0, bv - 0.15));
            }

            // Lip sync smoothing
            const lf = 12.0 * dt;
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

            currentVrm.update(dt);
        }

        if (mixer) mixer.update(dt);

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
}

