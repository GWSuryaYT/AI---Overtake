// ═══════════════════════════════════════════════════
//  GESTURE STUDIO & DEBUG WORKBENCH (v2)
//  Parametric timeline scrubbing, live keyframe editing,
//  TransformControls 3D target, OrbitControls, live metrics HUD,
//  undo/redo, one-click persistence & compact F2 toolbar.
// ═══════════════════════════════════════════════════

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

import './debug_panel.css';
import { DEBUG } from './avatar_config.js';
import { avatarFrame } from './frame.js';
import { avatarLandmarks } from './landmarks.js';
import { GESTURE_LIBRARY, GESTURE_MODES } from './gesture_library.js';
import cueVocab from './cue_vocab.json';
import { ProgramPlayer } from './program_player.js';

import { StudioHistory } from './studio_history.js';
import { validateGestureLibrary, validateGestureProgram, KNOWN_PALMS, KNOWN_POLES, KNOWN_SHAPES, KNOWN_LEADS } from './studio_validator.js';
import { EMOTIONS, updateEmotion, setEmotions } from './emotion_map.js';
import { computeEmotionDistance, findSimilarEmotionPairs, getClosestNeighbor } from './emotion_similarity.js';

// ── State variables ──
let _director = null;
let _scene = null;
let _gestureEngine = null;
let _armLayer = null;
let _renderer3D = null;
let _camera = null;

let _orbitControls = null;
let _transformControls = null;
let _transformControlsR = null;
let _gizmoProxyR = null;
let _transformControlsL = null;
let _gizmoProxyL = null;
let _gizmoProxy = null;
let _isTransformDragging = false;


let _isInitialized = false;
let _isStudioMode = false;
let _modelReport = null;

import { avatarLayers, isLayerEnabled, toggleLayer } from './layers.js';

export { isLayerEnabled };

// ── Gesture Studio Core State ──
const _studio = {
    library: JSON.parse(JSON.stringify(GESTURE_LIBRARY)),
    modes: JSON.parse(JSON.stringify(GESTURE_MODES)),
    selectedGesture: 'wave',
    selectedKeyIndex: 0,
    selectedHand: 'right', // 'left' | 'right' | 'both'
    linkHands: true,
    isLooping: false,
    speed: 1.0,
    intensity: 1.0,
    seed: 12345,
    deterministic: true,
    isUnsaved: false,
    activeTab: 'gestures', // 'gestures' | 'emotions' | 'body' | 'layers' | 'live'
    hudArm: 'right',
    solidBackground: true,
    snapshotA: null,
    isShowingSnapshotA: false,
    emotionsMap: JSON.parse(JSON.stringify(EMOTIONS)),
    selectedEmotion: 'happy',
    showCompareGrid: false,
};

const _history = new StudioHistory(60);

// ── Visual IK Gizmos Manager ──
class IKDebugGizmos {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.name = 'IKDebugGizmos';
        this.enabled = true;

        const matTargetL = new THREE.MeshBasicMaterial({ color: 0x00ffff, depthTest: false, transparent: true, opacity: 0.9 });
        const matTargetR = new THREE.MeshBasicMaterial({ color: 0xff00aa, depthTest: false, transparent: true, opacity: 0.9 });
        const matElbow = new THREE.MeshBasicMaterial({ color: 0xffea00, depthTest: false, transparent: true, opacity: 0.85 });
        const matLineL = new THREE.LineBasicMaterial({ color: 0x00e1ff, depthTest: false, transparent: true, opacity: 0.85, linewidth: 2 });
        const matLineR = new THREE.LineBasicMaterial({ color: 0xff00aa, depthTest: false, transparent: true, opacity: 0.85, linewidth: 2 });
        const matPoleLine = new THREE.LineBasicMaterial({ color: 0xffaa00, depthTest: false, transparent: true, opacity: 0.75 });

        const geomSmall = new THREE.SphereGeometry(0.016, 12, 12);

        this.sphereTargetL = new THREE.Mesh(geomSmall, matTargetL);
        this.sphereTargetR = new THREE.Mesh(geomSmall, matTargetR);
        this.sphereElbowL = new THREE.Mesh(geomSmall, matElbow);
        this.sphereElbowR = new THREE.Mesh(geomSmall, matElbow);

        const lineGeomL = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
        const lineGeomR = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
        this.lineArmL = new THREE.Line(lineGeomL, matLineL);
        this.lineArmR = new THREE.Line(lineGeomR, matLineR);

        const poleGeomL = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const poleGeomR = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        this.linePoleL = new THREE.Line(poleGeomL, matPoleLine);
        this.linePoleR = new THREE.Line(poleGeomR, matPoleLine);

        this.group.add(
            this.sphereTargetL, this.sphereTargetR,
            this.sphereElbowL, this.sphereElbowR,
            this.lineArmL, this.lineArmR,
            this.linePoleL, this.linePoleR
        );

        this.group.renderOrder = 9999;
        this.scene.add(this.group);
    }

    update(armLayer, gestureEngine) {
        if (!this.enabled) {
            this.group.visible = false;
            return;
        }

        // In studio mode, always visible
        this.group.visible = true;
        const d = armLayer?.debugPositions;
        if (!d) return;

        // Left Arm
        this.sphereTargetL.position.copy(d.leftTarget);
        this.sphereElbowL.position.copy(d.leftElbow);
        const posL = this.lineArmL.geometry.attributes.position;
        posL.setXYZ(0, d.leftShoulder.x, d.leftShoulder.y, d.leftShoulder.z);
        posL.setXYZ(1, d.leftElbow.x, d.leftElbow.y, d.leftElbow.z);
        posL.setXYZ(2, d.leftTarget.x, d.leftTarget.y, d.leftTarget.z);
        posL.needsUpdate = true;

        const poleL = this.linePoleL.geometry.attributes.position;
        poleL.setXYZ(0, d.leftElbow.x, d.leftElbow.y, d.leftElbow.z);
        poleL.setXYZ(1, d.leftElbow.x + d.leftPole.x * 0.15, d.leftElbow.y + d.leftPole.y * 0.15, d.leftElbow.z + d.leftPole.z * 0.15);
        poleL.needsUpdate = true;

        // Right Arm
        this.sphereTargetR.position.copy(d.rightTarget);
        this.sphereElbowR.position.copy(d.rightElbow);
        const posR = this.lineArmR.geometry.attributes.position;
        posR.setXYZ(0, d.rightShoulder.x, d.rightShoulder.y, d.rightShoulder.z);
        posR.setXYZ(1, d.rightElbow.x, d.rightElbow.y, d.rightElbow.z);
        posR.setXYZ(2, d.rightTarget.x, d.rightTarget.y, d.rightTarget.z);
        posR.needsUpdate = true;

        const poleR = this.linePoleR.geometry.attributes.position;
        poleR.setXYZ(0, d.rightElbow.x, d.rightElbow.y, d.rightElbow.z);
        poleR.setXYZ(1, d.rightElbow.x + d.rightPole.x * 0.15, d.rightElbow.y + d.rightPole.y * 0.15, d.rightElbow.z + d.rightPole.z * 0.15);
        poleR.needsUpdate = true;
    }
}

let _gizmosInstance = null;

/**
 * Initialize Debug & Gesture Studio
 */
export function initDebug(director, scene = null, gestureEngine = null, armLayer = null, renderer = null, camera = null) {
    _director = director;
    _scene = scene;
    _gestureEngine = gestureEngine;
    _armLayer = armLayer;
    _renderer3D = renderer;
    _camera = camera;

    if (_isInitialized) return;
    _isInitialized = true;

    _isStudioMode = (typeof window !== 'undefined') &&
        (window.location.search.includes('studio=1') || window.location.search.includes('workbench=1'));

    // Try restoring saved working copy from localStorage
    try {
        const saved = localStorage.getItem('anna_gesture_studio_data');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.GESTURE_LIBRARY) {
                _studio.library = parsed.GESTURE_LIBRARY;
                _studio.modes = parsed.GESTURE_MODES || _studio.modes;
            }
        }
    } catch (e) {
        console.warn('[Studio] Could not load localStorage:', e);
    }

    if (_scene) {
        _gizmosInstance = new IKDebugGizmos(_scene);
    }

    // Build History initial state
    _history.push(_studio.library, 'Initial Load');

    // Build UI according to mode
    if (_isStudioMode) {
        _initStudioMode();
    } else {
        _initCompactMode();
    }

    // Expose window.anna API
    _setupAnnaAPI();

    // Global keyboard listener
    window.addEventListener('keydown', _handleKeyDown);
}

function _setupAnnaAPI() {
    window.anna = {
        cue: (cueObj) => { if (_director?.applyCue) _director.applyCue(cueObj); },
        emotion: (name, intensity = 1.0) => { window.anna.cue({ emotion: name, intensity }); },
        gesture: (name, opts = {}) => {
            const hand = opts.hand || 'dominant';
            const intensity = opts.intensity !== undefined ? opts.intensity : 1.0;
            const loop = !!opts.loop;
            if (_gestureEngine) {
                _gestureEngine.trigger(name, intensity, hand, { force: true, loop });
            }
        },
        freeze: (shouldFreeze = true) => {
            if (_gestureEngine) {
                _gestureEngine.freeze(shouldFreeze, _studio.selectedGesture, _studio.selectedHand);
            }
        },
        reset: () => {
            if (_gestureEngine) _gestureEngine.resetToIdle();
        },
        layers: avatarLayers,
        toggleLayer: (name) => {
            toggleLayer(name);
            _updateLayersUI();
        },
        exportConfig: () => _copyLibraryJSON(),
        dump: () => {
            console.group('🤖 Anna Debug Dump');
            console.log('Director:', _director);
            console.log('Engine Debug:', _gestureEngine?.debug);
            console.log('Current Program:', _studio.library[_studio.selectedGesture]);
            console.groupEnd();
        }
    };
}

// ═══════════════════════════════════════════════════
//  STUDIO MODE INITIALIZATION (/?studio=1)
// ═══════════════════════════════════════════════════

let _studioRoot = null;
let _timelineTrackEl = null;
let _timelinePlayheadEl = null;
let _timeDisplayEl = null;
let _statusChipEl = null;

function _initStudioMode() {
    // 1. Take over GestureEngine
    if (_gestureEngine) {
        _gestureEngine.debug.active = true;
        _gestureEngine.debug.deterministic = _studio.deterministic;
        _gestureEngine.debug.speed = _studio.speed;
        _gestureEngine.debug.handSel = _studio.selectedHand;
        _gestureEngine.debug.seed = _studio.seed;
        _gestureEngine.debug.intensity = _studio.intensity;
    }

    // 2. Adjust body/html styling for studio
    document.documentElement.style.background = '#0e1117';
    document.body.style.background = '#0e1117';
    document.body.style.overflow = 'hidden';

    // Hide default settings button if present
    const settingsContainer = document.getElementById('settings-container');
    if (settingsContainer) settingsContainer.style.display = 'none';

    // 3. Build Studio DOM structure
    _studioRoot = document.createElement('div');
    _studioRoot.id = 'anna-studio-root';
    _studioRoot.innerHTML = `
        <div id="studio-viewport-container">
            <div class="studio-camera-toolbar">
                <button class="studio-camera-btn" data-cam="full">Full Body</button>
                <button class="studio-camera-btn active" data-cam="upper">Upper Body</button>
                <button class="studio-camera-btn" data-cam="hand-r">Right Hand</button>
                <button class="studio-camera-btn" data-cam="hand-l">Left Hand</button>
                <button class="studio-camera-btn" data-cam="side">Side View</button>
                <button class="studio-camera-btn" data-cam="top">Top View</button>
                <button class="studio-camera-btn" id="btn-bg-toggle">Solid BG</button>
            </div>

            <!-- Live Metrics HUD -->
            <div class="studio-hud-overlay" id="studio-hud">
                <div class="hud-title-row">
                    <span>LIVE METRICS</span>
                    <div class="hud-arm-toggle">
                        <button class="hud-arm-btn" id="hud-btn-l">L</button>
                        <button class="hud-arm-btn active" id="hud-btn-r">R</button>
                    </div>
                </div>
                <div class="hud-metric-row">
                    <span>Reach (d/R):</span>
                    <span id="hud-val-reach">0.00 / 0.00 m (0%)</span>
                </div>
                <div class="hud-reach-bar-container">
                    <div class="hud-reach-band" title="Allowed natural reach band [0.35R, 0.94R]"></div>
                    <div class="hud-reach-pointer" id="hud-reach-pointer"></div>
                </div>
                <div class="hud-metric-row">
                    <span>Elbow Angle:</span>
                    <span id="hud-val-elbow">0.0°</span>
                </div>
                <div class="hud-metric-row">
                    <span>Soft Limiter:</span>
                    <span id="hud-val-soft">Inactive</span>
                </div>
                <div class="hud-metric-row">
                    <span>Clearance (Torso/Head):</span>
                    <span id="hud-val-clearance">0.0 / 0.0 cm</span>
                </div>
                <div class="hud-metric-row">
                    <span>Tracking Error:</span>
                    <span id="hud-val-error">0.0 mm</span>
                </div>
                <div id="hud-badges-container" style="display:flex; flex-wrap:wrap; gap:4px; margin-top:6px;"></div>
            </div>

            <div id="studio-viewport-canvas-wrapper"></div>

            <!-- Timeline & Transport Bar -->
            <div id="studio-timeline-container">
                <div class="studio-transport-row">
                    <div class="transport-btn-group">
                        <button class="transport-btn" id="btn-transport-play" title="Play / Pause (Space)">▶</button>
                        <button class="transport-btn" id="btn-transport-fire" title="Fire from start (F)">⏮</button>
                        <button class="transport-btn" id="btn-transport-step-back" title="Step Back (Left Arrow)">◀</button>
                        <button class="transport-btn" id="btn-transport-step-fwd" title="Step Forward (Right Arrow)">▶</button>
                        <button class="transport-btn" id="btn-transport-prev-key" title="Prev Keyframe ([)">⇤</button>
                        <button class="transport-btn" id="btn-transport-next-key" title="Next Keyframe (])">⇥</button>
                        <button class="transport-btn" id="btn-transport-loop" title="Toggle Loop (L)">🔁</button>
                        <button class="transport-btn" id="btn-transport-reset" title="Reset (R)">↺</button>
                    </div>

                    <div class="transport-btn-group">
                        <span class="transport-time-display" id="studio-time-display">0.00s / 0.00s</span>
                        <select class="studio-select" id="studio-speed-select" style="width:72px;">
                            <option value="0.1">0.1×</option>
                            <option value="0.25">0.25×</option>
                            <option value="0.5">0.5×</option>
                            <option value="1.0" selected>1.0×</option>
                            <option value="1.5">1.5×</option>
                            <option value="2.0">2.0×</option>
                        </select>
                        <select class="studio-select" id="studio-hand-select" style="width:80px;">
                            <option value="right" selected>Right</option>
                            <option value="left">Left</option>
                            <option value="both">Both</option>
                            <option value="auto">Auto</option>
                        </select>
                        <label style="display:flex; align-items:center; gap:4px; font-size:11px; color:var(--studio-text-muted); cursor:pointer;">
                            <input type="checkbox" id="chk-link-hands" checked> Link
                        </label>
                        <label style="display:flex; align-items:center; gap:4px; font-size:11px; color:var(--studio-text-muted); cursor:pointer;">
                            <input type="checkbox" id="chk-deterministic" checked> Deterministic
                        </label>
                    </div>
                </div>

                <div class="timeline-track-container" id="studio-timeline-track">
                    <div id="timeline-segments-wrapper" style="position:relative; width:100%; height:100%;"></div>
                    <div class="timeline-playhead" id="studio-playhead">
                        <div class="timeline-playhead-cap"></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Splitter -->
        <div id="studio-splitter"></div>

        <!-- Right: Studio Controls Panel -->
        <div id="studio-panel-container">
            <div class="studio-header">
                <div class="studio-title-group">
                    <span class="studio-logo">ANNA STUDIO</span>
                    <span class="studio-status-chip status-paused" id="studio-status-chip">PAUSED</span>
                </div>
                <div class="header-action-group">
                    <button class="studio-action-btn primary" id="btn-save-project" title="Save to project (Ctrl+S)">💾 Save</button>
                    <button class="studio-action-btn" id="btn-undo" title="Undo (Ctrl+Z)">↶</button>
                    <button class="studio-action-btn" id="btn-redo" title="Redo (Ctrl+Shift+Z)">↷</button>
                    <button class="studio-action-btn" id="btn-help" title="Keyboard shortcuts (?)">?</button>
                </div>
            </div>

            <!-- Tabs -->
            <div class="studio-tabs-bar">
                <button class="studio-tab-btn active" data-tab="gestures">Gestures</button>
                <button class="studio-tab-btn" data-tab="emotions">Emotions</button>
                <button class="studio-tab-btn" data-tab="body">Body & Gaze</button>
                <button class="studio-tab-btn" data-tab="layers">Layers</button>
                <button class="studio-tab-btn" data-tab="live">Live</button>
            </div>

            <!-- Tab Content -->
            <div class="studio-tab-content" id="studio-tab-body"></div>
        </div>
    `;

    document.body.appendChild(_studioRoot);

    // 4. Move Three.js Canvas to #studio-viewport-canvas-wrapper
    const appEl = document.getElementById('app');
    const canvasWrapper = document.getElementById('studio-viewport-canvas-wrapper');
    if (appEl && canvasWrapper) {
        canvasWrapper.appendChild(appEl);
        appEl.style.width = '100%';
        appEl.style.height = '100%';
        appEl.style.position = 'absolute';
        appEl.style.top = '0';
        appEl.style.left = '0';
    }

    _timelineTrackEl = document.getElementById('studio-timeline-track');
    _timelinePlayheadEl = document.getElementById('studio-playhead');
    _timeDisplayEl = document.getElementById('studio-time-display');
    _statusChipEl = document.getElementById('studio-status-chip');

    // 5. Setup OrbitControls & Camera presets
    _setupStudioControls();

    // 6. Setup Splitter Resizing
    _setupSplitter();

    // 7. Setup Timeline Dragging & Scrubbing
    _setupTimelineEvents();

    // 8. Render Tab Body
    _renderTab('gestures');

    // 9. Select & play initial gesture
    _selectGesture(_studio.selectedGesture);
}

// ═══════════════════════════════════════════════════
//  STUDIO THREE.JS CONTROLS & CAMERA
// ═══════════════════════════════════════════════════

function _setupStudioControls() {
    if (!_camera || !_renderer3D) return;

    // OrbitControls
    _orbitControls = new OrbitControls(_camera, _renderer3D.domElement);
    _orbitControls.enableDamping = true;
    _orbitControls.dampingFactor = 0.08;
    _orbitControls.target.set(0, 1.2, 0);

    // Default Upper Body camera
    _setCameraPreset('upper');

    // TransformControls for Right wrist target
    _transformControlsR = new TransformControls(_camera, _renderer3D.domElement);
    _transformControlsR.size = 0.65;
    _transformControlsR.space = 'world';

    _gizmoProxyR = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff00aa, transparent: true, opacity: 0.85 })
    );
    _scene.add(_gizmoProxyR);
    _scene.add(_transformControlsR);
    _transformControlsR.attach(_gizmoProxyR);

    _transformControlsR.addEventListener('dragging-changed', (e) => {
        _isTransformDragging = !!e.value;
        if (_orbitControls) _orbitControls.enabled = !e.value;
    });

    _transformControlsR.addEventListener('change', () => {
        if (_isTransformDragging) {
            _onTransformGizmoDrag('right');
        }
    });

    // TransformControls for Left wrist target
    _transformControlsL = new TransformControls(_camera, _renderer3D.domElement);
    _transformControlsL.size = 0.65;
    _transformControlsL.space = 'world';

    _gizmoProxyL = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.85 })
    );
    _scene.add(_gizmoProxyL);
    _scene.add(_transformControlsL);
    _transformControlsL.attach(_gizmoProxyL);

    _transformControlsL.addEventListener('dragging-changed', (e) => {
        _isTransformDragging = !!e.value;
        if (_orbitControls) _orbitControls.enabled = !e.value;
    });

    _transformControlsL.addEventListener('change', () => {
        if (_isTransformDragging) {
            _onTransformGizmoDrag('left');
        }
    });

    _transformControls = _transformControlsR;
    _gizmoProxy = _gizmoProxyR;

    // Camera toolbar preset buttons
    document.querySelectorAll('.studio-camera-btn[data-cam]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.studio-camera-btn[data-cam]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _setCameraPreset(btn.dataset.cam);
        });
    });

    const btnBg = document.getElementById('btn-bg-toggle');
    if (btnBg) {
        btnBg.addEventListener('click', () => {
            _studio.solidBackground = !_studio.solidBackground;
            btnBg.textContent = _studio.solidBackground ? 'Solid BG' : 'Transparent BG';
            if (_renderer3D) {
                if (_studio.solidBackground) {
                    _renderer3D.setClearColor(0x0e1117, 1);
                } else {
                    _renderer3D.setClearColor(0x000000, 0);
                }
            }
        });
        if (_renderer3D) _renderer3D.setClearColor(0x0e1117, 1);
    }
}

function _setCameraPreset(preset) {
    if (!_camera || !_orbitControls) return;

    switch (preset) {
        case 'full':
            _camera.position.set(0, 1.05, 2.2);
            _orbitControls.target.set(0, 0.95, 0);
            break;
        case 'upper':
            _camera.position.set(0, 1.25, 1.2);
            _orbitControls.target.set(0, 1.2, 0);
            break;
        case 'hand-r':
            _camera.position.set(-0.30, 1.25, 0.75);
            _orbitControls.target.set(-0.25, 1.20, 0.1);
            break;
        case 'hand-l':
            _camera.position.set(0.30, 1.25, 0.75);
            _orbitControls.target.set(0.25, 1.20, 0.1);
            break;
        case 'side':
            _camera.position.set(1.6, 1.2, 0);
            _orbitControls.target.set(0, 1.1, 0);
            break;
        case 'top':
            _camera.position.set(0, 2.2, 0.1);
            _orbitControls.target.set(0, 1.0, 0);
            break;
    }
    _orbitControls.update();
}

function _updateGizmoProxyPosition() {
    if (_isTransformDragging) return;

    const prog = _studio.library[_studio.selectedGesture];
    if (!prog || !prog.keys) return;

    const kIdx = _studio.selectedKeyIndex;
    const handSel = _studio.selectedHand;
    const isBoth = (handSel === 'both') || (handSel === 'auto' && prog.lead === 'both');
    const isLeft = (handSel === 'left') || (handSel === 'auto' && prog.lead === 'left');
    const isRight = (handSel === 'right') || (handSel === 'auto' && prog.lead !== 'both' && prog.lead !== 'left');

    const keyR = prog.overrides?.right?.keys?.[kIdx] || prog.keys[kIdx];
    const keyL = prog.overrides?.left?.keys?.[kIdx] || prog.keys[kIdx];

    if (_transformControlsR && _gizmoProxyR) {
        if ((isBoth || isRight) && keyR) {
            _transformControlsR.visible = true;
            _transformControlsR.enabled = true;
            const worldPosR = new THREE.Vector3();
            avatarLandmarks.offsetToWorld('right', keyR.pos, worldPosR);
            _gizmoProxyR.position.copy(worldPosR);
        } else {
            _transformControlsR.visible = false;
            _transformControlsR.enabled = false;
        }
    }

    if (_transformControlsL && _gizmoProxyL) {
        if ((isBoth || isLeft) && keyL) {
            _transformControlsL.visible = true;
            _transformControlsL.enabled = true;
            const worldPosL = new THREE.Vector3();
            avatarLandmarks.offsetToWorld('left', keyL.pos, worldPosL);
            _gizmoProxyL.position.copy(worldPosL);
        } else {
            _transformControlsL.visible = false;
            _transformControlsL.enabled = false;
        }
    }
}

function _onTransformGizmoDrag(draggedSide = 'right') {
    const prog = _studio.library[_studio.selectedGesture];
    if (!prog || !prog.keys) return;

    const gizmo = (draggedSide === 'left') ? _gizmoProxyL : _gizmoProxyR;
    if (!gizmo) return;

    const shoulder = (draggedSide === 'left') ? avatarLandmarks.shoulderLeft : avatarLandmarks.shoulderRight;

    // Convert world target back to U-units
    const diff = new THREE.Vector3().subVectors(gizmo.position, shoulder);
    const invQ = new THREE.Quaternion();
    avatarFrame.getWorldQuaternion(invQ).invert();
    diff.applyQuaternion(invQ);

    const sign = (draggedSide === 'left') ? 1 : -1;
    const U = avatarLandmarks.U || 0.25;

    const newX = Math.round(((diff.x / U) * sign) * 100) / 100;
    const newY = Math.round((diff.y / U) * 100) / 100;
    const newZ = Math.round((diff.z / U) * 100) / 100;

    const kIdx = _studio.selectedKeyIndex;

    if (_studio.linkHands) {
        // Link is ON: mirrored edit on shared keys
        if (prog.keys && prog.keys[kIdx]) {
            prog.keys[kIdx].pos = [newX, newY, newZ];
        }
        if (prog.overrides?.left?.keys?.[kIdx]) prog.overrides.left.keys[kIdx].pos = [newX, newY, newZ];
        if (prog.overrides?.right?.keys?.[kIdx]) prog.overrides.right.keys[kIdx].pos = [newX, newY, newZ];

        // Mirror other gizmo
        const otherSide = (draggedSide === 'left') ? 'right' : 'left';
        const otherGizmo = (draggedSide === 'left') ? _gizmoProxyR : _gizmoProxyL;
        if (otherGizmo) {
            const worldOther = new THREE.Vector3();
            avatarLandmarks.offsetToWorld(otherSide, [newX, newY, newZ], worldOther);
            otherGizmo.position.copy(worldOther);
        }
    } else {
        // Link is OFF: write only that side's override
        if (!prog.overrides) prog.overrides = {};
        if (!prog.overrides[draggedSide]) {
            prog.overrides[draggedSide] = { keys: JSON.parse(JSON.stringify(prog.keys)) };
        }
        if (prog.overrides[draggedSide].keys && prog.overrides[draggedSide].keys[kIdx]) {
            prog.overrides[draggedSide].keys[kIdx].pos = [newX, newY, newZ];
        }
    }

    _markUnsaved();
    _applyLiveKeyframeEdit('Drag 3D Target');
    _syncKeyframeInputs();
}


// ═══════════════════════════════════════════════════
//  SPLITTER RESIZING
// ═══════════════════════════════════════════════════

function _setupSplitter() {
    const splitter = document.getElementById('studio-splitter');
    const panel = document.getElementById('studio-panel-container');
    if (!splitter || !panel) return;

    let isResizing = false;

    splitter.addEventListener('mousedown', (e) => {
        isResizing = true;
        splitter.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const newWidth = Math.max(360, Math.min(750, window.innerWidth - e.clientX));
        panel.style.width = `${newWidth}px`;

        // Update ThreeJS render size to match viewport container
        const canvasWrapper = document.getElementById('studio-viewport-canvas-wrapper');
        if (canvasWrapper && _renderer3D && _camera) {
            const w = canvasWrapper.clientWidth;
            const h = canvasWrapper.clientHeight;
            _camera.aspect = w / h;
            _camera.updateProjectionMatrix();
            _renderer3D.setSize(w, h);
        }
    });

    window.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            splitter.classList.remove('dragging');
            document.body.style.cursor = '';
        }
    });
}

// ═══════════════════════════════════════════════════
//  TIMELINE & TRANSPORT BAR
// ═══════════════════════════════════════════════════

function _setupTimelineEvents() {
    // Buttons
    document.getElementById('btn-transport-play')?.addEventListener('click', _togglePlayPause);
    document.getElementById('btn-transport-fire')?.addEventListener('click', () => _seekTimeline(0));
    document.getElementById('btn-transport-step-back')?.addEventListener('click', () => _stepFrame(-1));
    document.getElementById('btn-transport-step-fwd')?.addEventListener('click', () => _stepFrame(1));
    document.getElementById('btn-transport-prev-key')?.addEventListener('click', () => _jumpKeyframe(-1));
    document.getElementById('btn-transport-next-key')?.addEventListener('click', () => _jumpKeyframe(1));
    document.getElementById('btn-transport-loop')?.addEventListener('click', _toggleLoop);
    document.getElementById('btn-transport-reset')?.addEventListener('click', _resetEngine);

    document.getElementById('studio-speed-select')?.addEventListener('change', (e) => {
        _studio.speed = parseFloat(e.target.value);
        if (_gestureEngine) _gestureEngine.debug.speed = _studio.speed;
    });

    document.getElementById('studio-hand-select')?.addEventListener('change', (e) => {
        _studio.selectedHand = e.target.value;
        if (_studio.selectedHand === 'left') {
            _studio.hudArm = 'left';
            document.getElementById('hud-btn-l')?.classList.add('active');
            document.getElementById('hud-btn-r')?.classList.remove('active');
        } else if (_studio.selectedHand === 'right') {
            _studio.hudArm = 'right';
            document.getElementById('hud-btn-r')?.classList.add('active');
            document.getElementById('hud-btn-l')?.classList.remove('active');
        }
        if (_gestureEngine) _gestureEngine.debug.handSel = _studio.selectedHand;
        _rebuildPlayer();
        _renderTab('gestures');
    });

    document.getElementById('chk-link-hands')?.addEventListener('change', (e) => {
        _studio.linkHands = !!e.target.checked;
        _renderTab('gestures');
    });

    document.getElementById('chk-deterministic')?.addEventListener('change', (e) => {
        _studio.deterministic = !!e.target.checked;
        if (_gestureEngine) _gestureEngine.debug.deterministic = _studio.deterministic;
        _rebuildPlayer();
    });

    // Timeline Scrubbing
    let isScrubbing = false;

    const handleScrub = (e) => {
        if (!_timelineTrackEl || !_gestureEngine?.debug?.player) return;
        const rect = _timelineTrackEl.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const dur = _gestureEngine.debug.player.duration;
        _seekTimeline(ratio * dur);
    };

    _timelineTrackEl.addEventListener('mousedown', (e) => {
        isScrubbing = true;
        handleScrub(e);
    });

    window.addEventListener('mousemove', (e) => {
        if (isScrubbing) handleScrub(e);
    });

    window.addEventListener('mouseup', () => {
        isScrubbing = false;
    });

    // Header buttons
    document.getElementById('btn-save-project')?.addEventListener('click', _saveToProject);
    document.getElementById('btn-undo')?.addEventListener('click', _undo);
    document.getElementById('btn-redo')?.addEventListener('click', _redo);
    document.getElementById('btn-help')?.addEventListener('click', _showShortcutsHelp);

    // HUD buttons
    document.getElementById('hud-btn-l')?.addEventListener('click', () => {
        _studio.hudArm = 'left';
        document.getElementById('hud-btn-l').classList.add('active');
        document.getElementById('hud-btn-r').classList.remove('active');
        if (!_studio.linkHands) _renderTab('gestures');
    });
    document.getElementById('hud-btn-r')?.addEventListener('click', () => {
        _studio.hudArm = 'right';
        document.getElementById('hud-btn-r').classList.add('active');
        document.getElementById('hud-btn-l').classList.remove('active');
        if (!_studio.linkHands) _renderTab('gestures');
    });

    // Tabs
    document.querySelectorAll('.studio-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.studio-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _studio.activeTab = btn.dataset.tab;
            _renderTab(btn.dataset.tab);
        });
    });
}

function _togglePlayPause() {
    if (!_gestureEngine?.debug) return;
    _gestureEngine.debug.paused = !_gestureEngine.debug.paused;
    _updateStatusChip();
    const btn = document.getElementById('btn-transport-play');
    if (btn) btn.textContent = _gestureEngine.debug.paused ? '▶' : '⏸';
}

function _toggleLoop() {
    _studio.isLooping = !_studio.isLooping;
    if (_gestureEngine?.debug) _gestureEngine.debug.loop = _studio.isLooping;
    const btn = document.getElementById('btn-transport-loop');
    if (btn) btn.classList.toggle('active', _studio.isLooping);
    _updateStatusChip();
}

function _resetEngine() {
    if (_gestureEngine) {
        _gestureEngine.resetToIdle();
        _gestureEngine.debug.t = 0;
        _gestureEngine.debug.paused = true;
    }
    _seekTimeline(0);
    _updateStatusChip();
}

function _seekTimeline(t) {
    if (!_gestureEngine?.debug?.player) return;
    const dur = _gestureEngine.debug.player.duration;
    _gestureEngine.debug.t = Math.max(0, Math.min(dur, t));
    // Immediately evaluate live
    if (_gestureEngine._applyDebugPose) {
        _gestureEngine._applyDebugPose();
    } else {
        const pose = _gestureEngine.debug.player.evaluate(_gestureEngine.debug.t);
        _gestureEngine._applyDebugPose(pose);
    }
    _updateTimelinePlayhead();
}

function _stepFrame(frames = 1) {
    if (!_gestureEngine?.debug) return;
    _gestureEngine.debug.paused = true;
    const dt = (1.0 / 60.0) * frames;
    _seekTimeline(_gestureEngine.debug.t + dt);
    _updateStatusChip();
}

function _jumpKeyframe(direction = 1) {
    const prog = _studio.library[_studio.selectedGesture];
    if (!prog || !prog.keys) return;

    let nextIdx = _studio.selectedKeyIndex + direction;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= prog.keys.length) nextIdx = prog.keys.length - 1;

    _selectKeyframe(nextIdx);
}

function _selectKeyframe(keyIndex) {
    _studio.selectedKeyIndex = keyIndex;
    const player = _gestureEngine?.debug?.player;
    if (player) {
        const peakT = player.getKeyPeakTime(keyIndex);
        _seekTimeline(peakT);
    }
    _updateGizmoProxyPosition();
    _syncKeyframeInputs();
}

function _selectGesture(name) {
    _studio.selectedGesture = name;
    if (name === 'none') {
        if (_gestureEngine) {
            _gestureEngine.resetToIdle();
        }
        _renderTimelineSegments();
        _renderTab(_studio.activeTab);
        _updateStatusChip();
        return;
    }
    if (!_studio.library[name]) return;
    _studio.selectedKeyIndex = 0;

    _rebuildPlayer();
    _seekTimeline(0);

    // Play once
    if (_gestureEngine?.debug) {
        _gestureEngine.debug.paused = false;
    }

    _renderTimelineSegments();
    _renderTab(_studio.activeTab);
    _updateStatusChip();
}


function _rebuildPlayer() {
    const prog = _studio.library[_studio.selectedGesture];
    if (!prog || !_gestureEngine) return;

    if (_gestureEngine._setupDebugPlayers) {
        _gestureEngine._setupDebugPlayers(prog, _studio.selectedHand, _studio.intensity);
    } else {
        const side = (_studio.selectedHand === 'left') ? 'left' : 'right';
        const player = new ProgramPlayer(prog, {
            seed: _studio.seed,
            side,
            intensity: _studio.intensity,
            deterministic: _studio.deterministic,
            holdDuration: prog.holdUntilReleased ? 3.0 : undefined
        });

        _gestureEngine.debug.program = prog;
        _gestureEngine.debug.player = player;
    }
    _gestureEngine.debug.gestureName = _studio.selectedGesture;

    _renderTimelineSegments();
    _updateGizmoProxyPosition();
}

function _renderTimelineSegments() {
    const wrapper = document.getElementById('timeline-segments-wrapper');
    if (!wrapper || !_gestureEngine?.debug?.player) return;

    wrapper.innerHTML = '';
    const player = _gestureEngine.debug.player;
    const totalDur = player.duration || 1.0;

    player.segments.forEach(seg => {
        const leftPct = (seg.t0 / totalDur) * 100;
        const widthPct = ((seg.t1 - seg.t0) / totalDur) * 100;

        const el = document.createElement('div');
        el.className = `timeline-segment seg-${seg.name.toLowerCase().replace(/#\d+/, '')}`;
        el.style.left = `${leftPct}%`;
        el.style.width = `${widthPct}%`;
        el.textContent = seg.name;
        el.title = `${seg.name} [${seg.t0.toFixed(2)}s - ${seg.t1.toFixed(2)}s]`;

        wrapper.appendChild(el);
    });

    // Diamonds for keyframes
    player.keyTargets.forEach(kt => {
        const leftPct = (kt.peakTime / totalDur) * 100;
        const diamond = document.createElement('div');
        diamond.className = 'timeline-key-diamond';
        diamond.style.left = `${leftPct}%`;
        diamond.title = `Key ${kt.keyIndex} peak: ${kt.peakTime.toFixed(2)}s`;
        diamond.addEventListener('click', (e) => {
            e.stopPropagation();
            _selectKeyframe(kt.keyIndex);
        });
        wrapper.appendChild(diamond);
    });

    // Oscillation peak tick
    const oscPeakT = player.getOscPeakTime();
    if (oscPeakT !== null) {
        const leftPct = (oscPeakT / totalDur) * 100;
        const tick = document.createElement('div');
        tick.className = 'timeline-osc-tick';
        tick.style.left = `${leftPct}%`;
        tick.title = `Oscillation Peak: ${oscPeakT.toFixed(2)}s`;
        wrapper.appendChild(tick);
    }
}

function _updateTimelinePlayhead() {
    if (!_timelinePlayheadEl || !_timeDisplayEl || !_gestureEngine?.debug?.player) return;

    const t = _gestureEngine.debug.t;
    const dur = _gestureEngine.debug.player.duration;
    const pct = Math.max(0, Math.min(100, (t / (dur || 1)) * 100));

    _timelinePlayheadEl.style.left = `${pct}%`;
    _timeDisplayEl.textContent = `${t.toFixed(2)}s / ${dur.toFixed(2)}s`;
}

function _updateStatusChip() {
    if (!_statusChipEl || !_gestureEngine?.debug) return;

    if (_studio.isUnsaved) {
        _statusChipEl.className = 'studio-status-chip status-unsaved';
        _statusChipEl.textContent = 'UNSAVED ●';
    } else if (_gestureEngine.debug.loop) {
        _statusChipEl.className = 'studio-status-chip status-looping';
        _statusChipEl.textContent = 'LOOPING';
    } else if (_gestureEngine.debug.paused) {
        _statusChipEl.className = 'studio-status-chip status-paused';
        _statusChipEl.textContent = 'PAUSED';
    } else {
        _statusChipEl.className = 'studio-status-chip status-playing';
        _statusChipEl.textContent = 'PLAYING';
    }
}

function _markUnsaved() {
    _studio.isUnsaved = true;
    _updateStatusChip();
    // Auto-save working copy to localStorage
    try {
        localStorage.setItem('anna_gesture_studio_data', JSON.stringify({
            GESTURE_LIBRARY: _studio.library,
            GESTURE_MODES: _studio.modes
        }));
    } catch (e) {}
}

// ═══════════════════════════════════════════════════
//  STUDIO TABS RENDERING
// ═══════════════════════════════════════════════════

function _renderTab(tabName) {
    const container = document.getElementById('studio-tab-body');
    if (!container) return;
    container.innerHTML = '';

    switch (tabName) {
        case 'gestures':
            _renderGesturesTab(container);
            break;
        case 'emotions':
            _renderEmotionsTab(container);
            break;
        case 'body':
            _renderBodyGazeTab(container);
            break;
        case 'layers':
            _renderLayersTab(container);
            break;
        case 'live':
            _renderLiveTab(container);
            break;
    }
}

function _getActiveEditSide() {
    return (_studio.selectedHand === 'left') ? 'left' : (_studio.selectedHand === 'right') ? 'right' : (_studio.hudArm || 'right');
}

function _mutateKey(prog, kIdx, mutator) {
    if (_studio.linkHands) {
        if (prog.keys && prog.keys[kIdx]) {
            mutator(prog.keys[kIdx]);
        }
        if (prog.overrides?.left?.keys?.[kIdx]) {
            mutator(prog.overrides.left.keys[kIdx]);
        }
        if (prog.overrides?.right?.keys?.[kIdx]) {
            mutator(prog.overrides.right.keys[kIdx]);
        }
    } else {
        const side = _getActiveEditSide();
        if (!prog.overrides) prog.overrides = {};
        if (!prog.overrides[side]) {
            prog.overrides[side] = { keys: JSON.parse(JSON.stringify(prog.keys)) };
        }
        if (prog.overrides[side].keys && prog.overrides[side].keys[kIdx]) {
            mutator(prog.overrides[side].keys[kIdx]);
        }
    }
}

function _renderGesturesTab(container) {
    // 1. Gesture Selector Section
    const secSelect = document.createElement('div');
    secSelect.className = 'studio-section';
    secSelect.innerHTML = `
        <div class="section-header">
            <span class="section-title">Gesture Library (LLM Reachable)</span>
            <div style="display:flex; gap:4px;">
                <button class="coord-nudge-btn" id="btn-new-gesture">+ New</button>
                <button class="coord-nudge-btn" id="btn-dup-gesture">Duplicate</button>
                <button class="coord-nudge-btn" id="btn-del-gesture">Delete</button>
            </div>
        </div>
        <div class="gesture-pill-grid" id="gesture-pill-grid"></div>
        <details style="margin-top:10px; border-top:1px solid var(--studio-border); padding-top:6px;" id="internal-gestures-group">
            <summary style="cursor:pointer; font-size:11px; color:var(--studio-text-muted); font-weight:600; outline:none; user-select:none;">
                Internal (not LLM-reachable)
            </summary>
            <div class="gesture-pill-grid" id="internal-gesture-pill-grid" style="margin-top:6px;"></div>
        </details>
    `;
    container.appendChild(secSelect);

    const pillGrid = secSelect.querySelector('#gesture-pill-grid');
    const internalPillGrid = secSelect.querySelector('#internal-gesture-pill-grid');
    const internalDetails = secSelect.querySelector('#internal-gestures-group');

    const llmGestures = cueVocab.gestures || [];
    const internalNames = new Set(cueVocab.internal_gestures || []);

    // LLM gestures
    llmGestures.forEach(gName => {
        const pill = document.createElement('div');
        pill.className = `gesture-pill ${gName === _studio.selectedGesture ? 'active' : ''}`;
        pill.textContent = gName;
        pill.addEventListener('click', () => _selectGesture(gName));
        pillGrid.appendChild(pill);
    });

    // Internal gestures (any program in library not in LLM list, plus explicitly internal)
    const allInternal = new Set([...internalNames]);
    Object.keys(_studio.library).forEach(k => {
        if (!llmGestures.includes(k)) allInternal.add(k);
    });

    allInternal.forEach(gName => {
        if (!_studio.library[gName]) return;
        const pill = document.createElement('div');
        pill.className = `gesture-pill ${gName === _studio.selectedGesture ? 'active' : ''}`;
        pill.textContent = gName;
        pill.addEventListener('click', () => _selectGesture(gName));
        internalPillGrid.appendChild(pill);
        if (gName === _studio.selectedGesture) {
            internalDetails.open = true;
        }
    });

    secSelect.querySelector('#btn-new-gesture')?.addEventListener('click', _createNewGesture);
    secSelect.querySelector('#btn-dup-gesture')?.addEventListener('click', _duplicateGesture);
    secSelect.querySelector('#btn-del-gesture')?.addEventListener('click', _deleteGesture);

    if (_studio.selectedGesture === 'none') {
        const noneNotice = document.createElement('div');
        noneNotice.className = 'studio-section';
        noneNotice.style.cssText = 'color:var(--studio-text-muted); font-size:12px; text-align:center; padding:16px;';
        noneNotice.textContent = 'Current gesture: "none" (idle). Select a gesture above to view and edit keyframes.';
        container.appendChild(noneNotice);
        return;
    }

    const prog = _studio.library[_studio.selectedGesture];
    if (!prog) return;

    // 2. Keyframes Section
    const activeSide = _getActiveEditSide();
    const hasSideOverride = !!(prog.overrides && prog.overrides[activeSide] && prog.overrides[activeSide].keys);
    const keysToRender = (!_studio.linkHands && hasSideOverride) ? prog.overrides[activeSide].keys : prog.keys;

    const secKeys = document.createElement('div');
    secKeys.className = 'studio-section';
    secKeys.innerHTML = `
        <div class="section-header">
            <span class="section-title">Keyframes (${keysToRender.length})</span>
            <div style="display:flex; gap:4px;">
                <button class="coord-nudge-btn" id="btn-add-key">+ Add Key</button>
                <button class="coord-nudge-btn" id="btn-dup-key">Duplicate</button>
                <button class="coord-nudge-btn" id="btn-del-key">Delete</button>
            </div>
        </div>
        ${!_studio.linkHands ? `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; padding:6px 10px; background:rgba(255,255,255,0.04); border-radius:4px; font-size:11px;">
            <span>Target: <strong>${activeSide.toUpperCase()}</strong> ${hasSideOverride ? '<span style="background:#e67e22; color:#fff; padding:1px 5px; border-radius:3px; font-size:9px; margin-left:4px;">OVERRIDDEN</span>' : '<span style="color:var(--studio-text-muted); font-size:10px; margin-left:4px;">(Shared)</span>'}</span>
            ${hasSideOverride ? `<button class="coord-nudge-btn" id="btn-reset-side-override" style="font-size:10px; padding:2px 8px;">Reset to Shared</button>` : ''}
        </div>
        ` : ''}
        <div id="keyframes-list-container"></div>
    `;
    container.appendChild(secKeys);

    secKeys.querySelector('#btn-add-key')?.addEventListener('click', _addKeyframe);
    secKeys.querySelector('#btn-dup-key')?.addEventListener('click', _duplicateKeyframe);
    secKeys.querySelector('#btn-del-key')?.addEventListener('click', _deleteKeyframe);
    secKeys.querySelector('#btn-reset-side-override')?.addEventListener('click', () => {
        if (prog.overrides) {
            delete prog.overrides[activeSide];
            if (Object.keys(prog.overrides).length === 0) {
                delete prog.overrides;
            }
            _markUnsaved();
            _applyLiveKeyframeEdit('Reset side override');
            _renderTab('gestures');
        }
    });

    const keysContainer = secKeys.querySelector('#keyframes-list-container');
    keysToRender.forEach((key, kIdx) => {
        const card = document.createElement('div');
        card.className = `keyframe-card ${kIdx === _studio.selectedKeyIndex ? 'active' : ''}`;
        card.dataset.index = kIdx;

        card.innerHTML = `
            <div class="keyframe-card-header">
                <span>Keyframe ${kIdx}</span>
                <span style="font-size:11px; color:var(--studio-text-muted);">t: [${key.t[0]}s, ${key.t[1]}s]</span>
            </div>

            <!-- Coordinate Controls: X, Y, Z -->
            <div class="coord-control-row">
                <span class="coord-label">X (outward)</span>
                <input type="range" class="coord-slider" min="-1.5" max="1.5" step="0.01" value="${key.pos[0]}" data-axis="0">
                <input type="number" class="coord-num-input" step="0.01" value="${key.pos[0]}" data-axis="0">
                <div class="coord-nudge-group">
                    <button class="coord-nudge-btn" data-axis="0" data-delta="-0.05">-0.05</button>
                    <button class="coord-nudge-btn" data-axis="0" data-delta="-0.01">-0.01</button>
                    <button class="coord-nudge-btn" data-axis="0" data-delta="0.01">+0.01</button>
                    <button class="coord-nudge-btn" data-axis="0" data-delta="0.05">+0.05</button>
                </div>
            </div>

            <div class="coord-control-row">
                <span class="coord-label">Y (up)</span>
                <input type="range" class="coord-slider" min="-1.8" max="1.5" step="0.01" value="${key.pos[1]}" data-axis="1">
                <input type="number" class="coord-num-input" step="0.01" value="${key.pos[1]}" data-axis="1">
                <div class="coord-nudge-group">
                    <button class="coord-nudge-btn" data-axis="1" data-delta="-0.05">-0.05</button>
                    <button class="coord-nudge-btn" data-axis="1" data-delta="-0.01">-0.01</button>
                    <button class="coord-nudge-btn" data-axis="1" data-delta="0.01">+0.01</button>
                    <button class="coord-nudge-btn" data-axis="1" data-delta="0.05">+0.05</button>
                </div>
            </div>

            <div class="coord-control-row">
                <span class="coord-label">Z (forward)</span>
                <input type="range" class="coord-slider" min="-0.5" max="1.8" step="0.01" value="${key.pos[2]}" data-axis="2">
                <input type="number" class="coord-num-input" step="0.01" value="${key.pos[2]}" data-axis="2">
                <div class="coord-nudge-group">
                    <button class="coord-nudge-btn" data-axis="2" data-delta="-0.05">-0.05</button>
                    <button class="coord-nudge-btn" data-axis="2" data-delta="-0.01">-0.01</button>
                    <button class="coord-nudge-btn" data-axis="2" data-delta="0.01">+0.01</button>
                    <button class="coord-nudge-btn" data-axis="2" data-delta="0.05">+0.05</button>
                </div>
            </div>

            <!-- Palm & Hand Shape -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                <div>
                    <label style="font-size:10px; color:var(--studio-text-muted);">Palm</label>
                    <select class="studio-select sel-palm">
                        ${KNOWN_PALMS.map(p => `<option value="${p}" ${p === (key.palm || 'inward') ? 'selected' : ''}>${p}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label style="font-size:10px; color:var(--studio-text-muted);">Shape</label>
                    <select class="studio-select sel-shape">
                        ${KNOWN_SHAPES.map(s => `<option value="${s}" ${s === (key.shape || 'soft_open') ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </div>
            </div>

            <!-- Shoulder Lift & Pole -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                <div>
                    <label style="font-size:10px; color:var(--studio-text-muted);">Shoulder Lift</label>
                    <input type="number" class="coord-num-input inp-lift" style="width:100%; box-sizing:border-box;" step="0.01" min="-0.2" max="0.3" value="${key.shoulderLift || 0}">
                </div>
                <div>
                    <label style="font-size:10px; color:var(--studio-text-muted);">Pole Override</label>
                    <select class="studio-select sel-pole">
                        <option value="">(Inherit)</option>
                        ${KNOWN_POLES.map(pol => `<option value="${pol}" ${pol === key.pole ? 'selected' : ''}>${pol}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            _selectKeyframe(kIdx);
        });

        // Wire inputs
        card.querySelectorAll('.coord-slider, .coord-num-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const axis = parseInt(input.dataset.axis);
                const val = parseFloat(input.value);
                _mutateKey(prog, kIdx, (k) => { k.pos[axis] = val; });
                _markUnsaved();
                _applyLiveKeyframeEdit('Tweak coordinate');
                _syncKeyframeInputs();
            });
        });

        // Hover wheel fine-adjust (Shift = coarse)
        card.querySelectorAll('.coord-control-row').forEach(row => {
            row.addEventListener('wheel', (e) => {
                e.preventDefault();
                const slider = row.querySelector('.coord-slider');
                if (!slider) return;
                const axis = parseInt(slider.dataset.axis);
                const step = e.shiftKey ? 0.05 : 0.01;
                const dir = e.deltaY < 0 ? 1 : -1;
                _mutateKey(prog, kIdx, (k) => {
                    k.pos[axis] = Math.round((k.pos[axis] + dir * step) * 100) / 100;
                });
                _markUnsaved();
                _applyLiveKeyframeEdit('Scroll wheel adjust');
                _syncKeyframeInputs();
            }, { passive: false });
        });

        card.querySelectorAll('.coord-nudge-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const axis = parseInt(btn.dataset.axis);
                const delta = parseFloat(btn.dataset.delta);
                _mutateKey(prog, kIdx, (k) => {
                    k.pos[axis] = Math.round((k.pos[axis] + delta) * 100) / 100;
                });
                _markUnsaved();
                _applyLiveKeyframeEdit('Nudge coordinate');
                _syncKeyframeInputs();
            });
        });

        card.querySelector('.sel-palm')?.addEventListener('change', (e) => {
            _mutateKey(prog, kIdx, (k) => { k.palm = e.target.value; });
            _markUnsaved();
            _applyLiveKeyframeEdit('Change palm');
        });

        card.querySelector('.sel-shape')?.addEventListener('change', (e) => {
            _mutateKey(prog, kIdx, (k) => { k.shape = e.target.value; });
            _markUnsaved();
            _applyLiveKeyframeEdit('Change shape');
        });

        card.querySelector('.inp-lift')?.addEventListener('input', (e) => {
            _mutateKey(prog, kIdx, (k) => { k.shoulderLift = parseFloat(e.target.value); });
            _markUnsaved();
            _applyLiveKeyframeEdit('Change shoulder lift');
        });

        card.querySelector('.sel-pole')?.addEventListener('change', (e) => {
            _mutateKey(prog, kIdx, (k) => { k.pole = e.target.value || undefined; });
            _markUnsaved();
            _applyLiveKeyframeEdit('Change pole override');
        });

        keysContainer.appendChild(card);
    });

    // 3. Gesture Settings & Oscillator Block
    const secSettings = document.createElement('div');
    secSettings.className = 'studio-section';
    secSettings.innerHTML = `
        <div class="section-header">
            <span class="section-title">Gesture Settings</span>
            <button class="coord-nudge-btn" id="btn-snapshot-toggle">${_studio.isShowingSnapshotA ? 'Revert to Live' : 'Snapshot A'}</button>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div>
                <label style="font-size:10px; color:var(--studio-text-muted);">Lead</label>
                <select class="studio-select" id="setting-lead">
                    ${KNOWN_LEADS.map(l => `<option value="${l}" ${l === (prog.lead || 'dominant') ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
            </div>
            <div>
                <label style="font-size:10px; color:var(--studio-text-muted);">Pole</label>
                <select class="studio-select" id="setting-pole">
                    ${KNOWN_POLES.map(pol => `<option value="${pol}" ${pol === (prog.pole || 'elbow_down') ? 'selected' : ''}>${pol}</option>`).join('')}
                </select>
            </div>
        </div>

        <div style="margin-top:10px; display:flex; align-items:center; justify-content:space-between;">
            <label style="display:flex; align-items:center; gap:6px; font-size:11px; cursor:pointer;">
                <input type="checkbox" id="setting-hold-released" ${prog.holdUntilReleased ? 'checked' : ''}>
                Hold until released
            </label>
            <button class="coord-nudge-btn" id="btn-release-pose" style="display:${prog.holdUntilReleased ? 'inline-block' : 'none'};">Release Pose</button>
        </div>

        <!-- Oscillator Box -->
        <div style="margin-top:14px; padding-top:10px; border-top:1px solid var(--studio-border);">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                <label style="display:flex; align-items:center; gap:6px; font-size:11px; font-weight:600; cursor:pointer;">
                    <input type="checkbox" id="chk-enable-osc" ${prog.oscillate ? 'checked' : ''}> Forearm Oscillator
                </label>
                <button class="coord-nudge-btn" id="btn-jump-osc" style="display:${prog.oscillate ? 'inline-block' : 'none'};">Go to Osc Peak</button>
            </div>
            <div id="oscillator-controls" style="display:${prog.oscillate ? 'block' : 'none'};">
                <div style="margin-bottom:8px;">
                    <label style="font-size:10px; color:var(--studio-text-muted);">Kind</label>
                    <select class="studio-select" id="osc-kind">
                        <option value="forearm_swing" ${(prog.oscillate?.kind || 'forearm_swing') === 'forearm_swing' ? 'selected' : ''}>forearm_swing (Horizontal X)</option>
                        <option value="point_pulse" ${prog.oscillate?.kind === 'point_pulse' ? 'selected' : ''}>point_pulse (Forward Z)</option>
                        <option value="wrist_roll" ${prog.oscillate?.kind === 'wrist_roll' ? 'selected' : ''}>wrist_roll (Wrist Roll Z)</option>
                    </select>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                    <div>
                        <label style="font-size:10px; color:var(--studio-text-muted);">Cycles [min, max]</label>
                        <input type="text" class="coord-num-input" style="width:100%; box-sizing:border-box;" id="osc-cycles" value="${prog.oscillate?.cycles?.join(', ') || '3, 5'}">
                    </div>
                    <div>
                        <label style="font-size:10px; color:var(--studio-text-muted);">Freq (Hz) [min, max]</label>
                        <input type="text" class="coord-num-input" style="width:100%; box-sizing:border-box;" id="osc-freq" value="${prog.oscillate?.freq?.join(', ') || '2.4, 3.0'}">
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px;">
                    <div>
                        <label style="font-size:10px; color:var(--studio-text-muted);">Amp (deg) [min, max]</label>
                        <input type="text" class="coord-num-input" style="width:100%; box-sizing:border-box;" id="osc-amp" value="${prog.oscillate?.ampDeg?.join(', ') || '15, 22'}">
                    </div>
                    <div>
                        <label style="font-size:10px; color:var(--studio-text-muted);">Decay</label>
                        <input type="number" class="coord-num-input" style="width:100%; box-sizing:border-box;" step="0.05" id="osc-decay" value="${prog.oscillate?.decay || 0.85}">
                    </div>
                </div>
            </div>
        </div>
    `;
    container.appendChild(secSettings);

    secSettings.querySelector('#setting-lead')?.addEventListener('change', (e) => {
        prog.lead = e.target.value;
        _markUnsaved();
        _applyLiveKeyframeEdit('Change lead');
    });

    secSettings.querySelector('#setting-pole')?.addEventListener('change', (e) => {
        prog.pole = e.target.value;
        _markUnsaved();
        _applyLiveKeyframeEdit('Change pole');
    });

    secSettings.querySelector('#setting-hold-released')?.addEventListener('change', (e) => {
        prog.holdUntilReleased = !!e.target.checked;
        secSettings.querySelector('#btn-release-pose').style.display = prog.holdUntilReleased ? 'inline-block' : 'none';
        _markUnsaved();
        _applyLiveKeyframeEdit('Toggle holdUntilReleased');
    });

    secSettings.querySelector('#btn-release-pose')?.addEventListener('click', () => {
        if (_gestureEngine) _gestureEngine.releasePose();
    });

    secSettings.querySelector('#btn-snapshot-toggle')?.addEventListener('click', _toggleSnapshotA);

    secSettings.querySelector('#chk-enable-osc')?.addEventListener('change', (e) => {
        if (e.target.checked) {
            prog.oscillate = {
                kind: 'forearm_swing',
                cycles: [3, 5],
                freq: [2.4, 3.0],
                ampDeg: [16, 22],
                decay: 0.88
            };
        } else {
            delete prog.oscillate;
        }
        _markUnsaved();
        _applyLiveKeyframeEdit('Toggle oscillator');
        _renderTab('gestures');
    });

    secSettings.querySelector('#osc-kind')?.addEventListener('change', (e) => {
        if (prog.oscillate) {
            prog.oscillate.kind = e.target.value;
            _markUnsaved();
            _applyLiveKeyframeEdit('Change oscillator kind');
        }
    });

    secSettings.querySelector('#osc-cycles')?.addEventListener('change', (e) => {
        if (prog.oscillate) {
            const parts = e.target.value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
            if (parts.length >= 2) prog.oscillate.cycles = [parts[0], parts[1]];
            _markUnsaved();
            _applyLiveKeyframeEdit('Change oscillator cycles');
        }
    });

    secSettings.querySelector('#osc-freq')?.addEventListener('change', (e) => {
        if (prog.oscillate) {
            const parts = e.target.value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
            if (parts.length >= 2) prog.oscillate.freq = [parts[0], parts[1]];
            _markUnsaved();
            _applyLiveKeyframeEdit('Change oscillator freq');
        }
    });

    secSettings.querySelector('#osc-amp')?.addEventListener('change', (e) => {
        if (prog.oscillate) {
            const parts = e.target.value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
            if (parts.length >= 2) prog.oscillate.ampDeg = [parts[0], parts[1]];
            _markUnsaved();
            _applyLiveKeyframeEdit('Change oscillator amp');
        }
    });

    secSettings.querySelector('#osc-decay')?.addEventListener('input', (e) => {
        if (prog.oscillate) {
            prog.oscillate.decay = parseFloat(e.target.value);
            _markUnsaved();
            _applyLiveKeyframeEdit('Change oscillator decay');
        }
    });

    secSettings.querySelector('#btn-jump-osc')?.addEventListener('click', () => {
        const oscT = _gestureEngine?.debug?.player?.getOscPeakTime();
        if (oscT !== null) _seekTimeline(oscT);
    });

    // 4. Action Bar (Copy JSON, Import JSON, Revert)
    const secActions = document.createElement('div');
    secActions.className = 'studio-section';
    secActions.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:6px;">
            <button class="studio-action-btn" id="btn-copy-json">Copy JSON</button>
            <button class="studio-action-btn" id="btn-import-json">Import JSON</button>
            <button class="studio-action-btn" id="btn-revert-gesture">Revert</button>
        </div>
    `;
    container.appendChild(secActions);

    secActions.querySelector('#btn-copy-json')?.addEventListener('click', _copyCurrentGestureJSON);
    secActions.querySelector('#btn-import-json')?.addEventListener('click', _showImportDialog);
    secActions.querySelector('#btn-revert-gesture')?.addEventListener('click', _revertGesture);
}

function _getAvailableModelExpressions() {
    const mgr = window.anna?.expressionController?.expressionManager ||
                window.anna?.avatar?.expressionManager ||
                _director?.avatar?.expressionManager;
    if (mgr?.expressionMap) {
        return Object.keys(mgr.expressionMap).filter(k => !k.startsWith('blink') && !['aa', 'ee', 'ih', 'oh', 'ou'].includes(k));
    }
    return ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral'];
}

async function _saveEmotionsToProject() {
    try {
        const res = await fetch('/__anna/save-emotions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_studio.emotionsMap)
        });
        const data = await res.json();
        if (data.success) {
            setEmotions(_studio.emotionsMap);
            _showToast(`Saved Emotion Map! Backup: ${data.backupPath || '.anna_backups'}`);
        } else {
            alert('Failed to save emotions: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Save emotions error:', err);
        alert('Save request failed. Ensure Vite dev server is running.');
    }
}

function _renderEmotionsTab(container) {
    container.innerHTML = '';
    const canonical = cueVocab.emotions || [];
    const curEmo = _studio.selectedEmotion || 'happy';
    const cfg = _studio.emotionsMap[curEmo] || {
        expressions: {},
        headOffset: { pitch: 0, yaw: 0, roll: 0 },
        gaze: 'user',
        arousal: 0.5,
        valence: 0.0,
        blinkMultiplier: 1.0,
        breathMultiplier: 1.0,
        defaultGesture: 'none'
    };

    const flaggedPairs = findSimilarEmotionPairs(_studio.emotionsMap, 0.35);

    // 1. Header & Actions
    const secHeader = document.createElement('div');
    secHeader.className = 'studio-section';
    secHeader.innerHTML = `
        <div class="section-header">
            <span class="section-title">Emotion Lab</span>
            <div style="display:flex; gap:6px;">
                <button class="coord-nudge-btn" id="btn-toggle-compare">${_studio.showCompareGrid ? 'Hide Compare Grid' : 'Compare All Grid'}</button>
                <button class="studio-action-btn primary" id="btn-save-emotions" style="padding:2px 8px; font-size:10px;">Save Map</button>
            </div>
        </div>

        ${flaggedPairs.length > 0 ? `
            <div style="background:rgba(230,126,34,0.15); border:1px solid #e67e22; border-radius:4px; padding:6px 8px; font-size:11px; margin-bottom:10px; color:#f39c12;">
                ⚠️ <strong>Pairs Too Similar (&lt; 0.35):</strong>
                ${flaggedPairs.map(p => `<div>• <strong>${p.emoA}</strong> &amp; <strong>${p.emoB}</strong> (dist: ${p.distance})</div>`).join('')}
            </div>
        ` : `
            <div style="background:rgba(46,204,113,0.12); border:1px solid #2ecc71; border-radius:4px; padding:4px 8px; font-size:10px; margin-bottom:10px; color:#2ecc71;">
                ✓ All 13 canonical emotions are distinct (metric dist &ge; 0.35).
            </div>
        `}

        <!-- Compare All Grid (when toggled) -->
        ${_studio.showCompareGrid ? `
            <div id="emotion-compare-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:6px; margin-bottom:12px; max-height:260px; overflow-y:auto; padding-right:4px;">
                ${canonical.map(emo => {
                    const eCfg = _studio.emotionsMap[emo] || {};
                    const nb = getClosestNeighbor(emo, _studio.emotionsMap);
                    const isSelected = emo === curEmo;
                    const exprKeys = Object.keys(eCfg.expressions || {});
                    return `
                        <div class="emotion-compare-card ${isSelected ? 'active' : ''}" data-select-emo="${emo}" style="border:1px solid ${isSelected ? 'var(--studio-accent, #00d2ff)' : 'var(--studio-border)'}; background:rgba(255,255,255,${isSelected ? '0.08' : '0.03'}); border-radius:6px; padding:6px; cursor:pointer; font-size:10px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                                <strong style="color:${isSelected ? '#00d2ff' : 'var(--studio-text)'}">${emo}</strong>
                                <span style="font-size:8px; color:var(--studio-text-muted);">${nb.distance}</span>
                            </div>
                            <div style="font-size:9px; color:var(--studio-text-muted);">
                                ${exprKeys.map(k => `${k}: ${eCfg.expressions[k]}`).join(', ') || 'neutral'}
                            </div>
                            <div style="display:flex; gap:3px; margin-top:4px;">
                                <span style="background:rgba(255,255,255,0.06); padding:1px 4px; border-radius:3px; font-size:8px;">${eCfg.gaze || 'user'}</span>
                                <span style="background:rgba(255,255,255,0.06); padding:1px 4px; border-radius:3px; font-size:8px;">A:${eCfg.arousal ?? 0.5}</span>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        ` : ''}

        <!-- Emotion Pills Grid -->
        <div class="gesture-pill-grid">
            ${canonical.map(emo => {
                const nb = getClosestNeighbor(emo, _studio.emotionsMap);
                return `
                    <div class="gesture-pill ${emo === curEmo ? 'active' : ''}" data-emo="${emo}">
                        ${emo} <span style="font-size:9px; opacity:0.65;">(${nb.distance})</span>
                    </div>
                `;
            }).join('')}
        </div>
    `;
    container.appendChild(secHeader);

    secHeader.querySelector('#btn-toggle-compare')?.addEventListener('click', () => {
        _studio.showCompareGrid = !_studio.showCompareGrid;
        _renderEmotionsTab(container);
    });

    secHeader.querySelector('#btn-save-emotions')?.addEventListener('click', _saveEmotionsToProject);

    secHeader.querySelectorAll('[data-select-emo], .gesture-pill[data-emo]').forEach(el => {
        el.addEventListener('click', () => {
            const emo = el.dataset.selectEmo || el.dataset.emo;
            _studio.selectedEmotion = emo;
            if (window.anna) window.anna.emotion(emo, 1.0);
            _renderEmotionsTab(container);
        });
    });

    // 2. Emotion Tuning Section
    const secTuning = document.createElement('div');
    secTuning.className = 'studio-section';
    const availableExprs = _getAvailableModelExpressions();

    secTuning.innerHTML = `
        <div class="section-header">
            <span class="section-title">Tuning: <strong>${curEmo.toUpperCase()}</strong></span>
            <button class="coord-nudge-btn" id="btn-preview-emo">Preview 1.0</button>
        </div>

        <!-- Model Expressions -->
        <div style="margin-bottom:12px;">
            <div style="font-size:11px; font-weight:600; color:var(--studio-text-muted); margin-bottom:6px;">Model Expressions</div>
            ${availableExprs.map(expr => {
                const val = cfg.expressions?.[expr] || 0;
                return `
                    <div class="coord-control-row">
                        <span class="coord-label" style="width:85px; font-size:10px;">${expr}</span>
                        <input type="range" class="coord-slider expr-slider" data-expr="${expr}" min="0" max="1" step="0.01" value="${val}">
                        <span class="expr-val-display" style="width:32px; font-size:10px; text-align:right;">${val.toFixed(2)}</span>
                    </div>
                `;
            }).join('')}
        </div>

        <!-- Head Pose Offset -->
        <div style="margin-bottom:12px; padding-top:10px; border-top:1px solid var(--studio-border);">
            <div style="font-size:11px; font-weight:600; color:var(--studio-text-muted); margin-bottom:6px;">Head Pose Offset (rad)</div>
            <div class="coord-control-row">
                <span class="coord-label" style="width:85px; font-size:10px;">Pitch</span>
                <input type="range" class="coord-slider head-slider" data-axis="pitch" min="-0.25" max="0.25" step="0.01" value="${cfg.headOffset?.pitch || 0}">
                <span class="head-val-display" data-axis="pitch" style="width:32px; font-size:10px; text-align:right;">${(cfg.headOffset?.pitch || 0).toFixed(2)}</span>
            </div>
            <div class="coord-control-row">
                <span class="coord-label" style="width:85px; font-size:10px;">Yaw</span>
                <input type="range" class="coord-slider head-slider" data-axis="yaw" min="-0.25" max="0.25" step="0.01" value="${cfg.headOffset?.yaw || 0}">
                <span class="head-val-display" data-axis="yaw" style="width:32px; font-size:10px; text-align:right;">${(cfg.headOffset?.yaw || 0).toFixed(2)}</span>
            </div>
            <div class="coord-control-row">
                <span class="coord-label" style="width:85px; font-size:10px;">Roll</span>
                <input type="range" class="coord-slider head-slider" data-axis="roll" min="-0.25" max="0.25" step="0.01" value="${cfg.headOffset?.roll || 0}">
                <span class="head-val-display" data-axis="roll" style="width:32px; font-size:10px; text-align:right;">${(cfg.headOffset?.roll || 0).toFixed(2)}</span>
            </div>
        </div>

        <!-- Gaze & Dynamics -->
        <div style="margin-bottom:12px; padding-top:10px; border-top:1px solid var(--studio-border);">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div>
                    <label style="font-size:10px; color:var(--studio-text-muted);">Gaze Target</label>
                    <select class="studio-select" id="emo-gaze-sel">
                        ${(cueVocab.gaze_targets || []).map(g => `<option value="${g}" ${g === (cfg.gaze || 'user') ? 'selected' : ''}>${g}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label style="font-size:10px; color:var(--studio-text-muted);">Default Gesture</label>
                    <select class="studio-select" id="emo-gesture-sel">
                        ${(cueVocab.gestures || []).map(g => `<option value="${g}" ${g === (cfg.defaultGesture || 'none') ? 'selected' : ''}>${g}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                <div>
                    <label style="font-size:10px; color:var(--studio-text-muted);">Blink Rate: <span id="val-blink">${cfg.blinkMultiplier || 1.0}×</span></label>
                    <input type="range" class="coord-slider" id="emo-blink-mul" min="0.2" max="2.5" step="0.05" value="${cfg.blinkMultiplier || 1.0}">
                </div>
                <div>
                    <label style="font-size:10px; color:var(--studio-text-muted);">Breath Rate: <span id="val-breath">${cfg.breathMultiplier || 1.0}×</span></label>
                    <input type="range" class="coord-slider" id="emo-breath-mul" min="0.5" max="2.0" step="0.05" value="${cfg.breathMultiplier || 1.0}">
                </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                <div>
                    <label style="font-size:10px; color:var(--studio-text-muted);">Arousal: <span id="val-arousal">${cfg.arousal ?? 0.5}</span></label>
                    <input type="range" class="coord-slider" id="emo-arousal" min="0.0" max="1.0" step="0.05" value="${cfg.arousal ?? 0.5}">
                </div>
                <div>
                    <label style="font-size:10px; color:var(--studio-text-muted);">Valence: <span id="val-valence">${cfg.valence ?? 0.0}</span></label>
                    <input type="range" class="coord-slider" id="emo-valence" min="-1.0" max="1.0" step="0.05" value="${cfg.valence ?? 0.0}">
                </div>
            </div>
        </div>
    `;
    container.appendChild(secTuning);

    // Wire live tuning
    const _applyLiveEmotion = () => {
        updateEmotion(curEmo, cfg);
        if (window.anna) window.anna.emotion(curEmo, 1.0);
        _markUnsaved();
    };

    secTuning.querySelectorAll('.expr-slider').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const expr = slider.dataset.expr;
            const val = parseFloat(slider.value);
            if (!cfg.expressions) cfg.expressions = {};
            if (val > 0) {
                cfg.expressions[expr] = val;
            } else {
                delete cfg.expressions[expr];
            }
            const disp = slider.parentElement.querySelector('.expr-val-display');
            if (disp) disp.textContent = val.toFixed(2);
            _applyLiveEmotion();
        });
    });

    secTuning.querySelectorAll('.head-slider').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const axis = slider.dataset.axis;
            const val = parseFloat(slider.value);
            if (!cfg.headOffset) cfg.headOffset = { pitch: 0, yaw: 0, roll: 0 };
            cfg.headOffset[axis] = val;
            const disp = slider.parentElement.querySelector('.head-val-display');
            if (disp) disp.textContent = val.toFixed(2);
            _applyLiveEmotion();
        });
    });

    secTuning.querySelector('#emo-gaze-sel')?.addEventListener('change', (e) => {
        cfg.gaze = e.target.value;
        _applyLiveEmotion();
    });

    secTuning.querySelector('#emo-gesture-sel')?.addEventListener('change', (e) => {
        cfg.defaultGesture = e.target.value;
        _applyLiveEmotion();
    });

    secTuning.querySelector('#emo-blink-mul')?.addEventListener('input', (e) => {
        cfg.blinkMultiplier = parseFloat(e.target.value);
        secTuning.querySelector('#val-blink').textContent = `${cfg.blinkMultiplier.toFixed(2)}×`;
        _applyLiveEmotion();
    });

    secTuning.querySelector('#emo-breath-mul')?.addEventListener('input', (e) => {
        cfg.breathMultiplier = parseFloat(e.target.value);
        secTuning.querySelector('#val-breath').textContent = `${cfg.breathMultiplier.toFixed(2)}×`;
        _applyLiveEmotion();
    });

    secTuning.querySelector('#emo-arousal')?.addEventListener('input', (e) => {
        cfg.arousal = parseFloat(e.target.value);
        secTuning.querySelector('#val-arousal').textContent = cfg.arousal.toFixed(2);
        _applyLiveEmotion();
    });

    secTuning.querySelector('#emo-valence')?.addEventListener('input', (e) => {
        cfg.valence = parseFloat(e.target.value);
        secTuning.querySelector('#val-valence').textContent = cfg.valence.toFixed(2);
        _applyLiveEmotion();
    });

    secTuning.querySelector('#btn-preview-emo')?.addEventListener('click', () => {
        if (window.anna) window.anna.emotion(curEmo, 1.0);
    });
}

function _renderBodyGazeTab(container) {
    const sec = document.createElement('div');
    sec.className = 'studio-section';
    sec.innerHTML = `
        <div class="section-header">
            <span class="section-title">Gaze Mode</span>
        </div>
        <div class="gesture-pill-grid">
            ${(cueVocab.gaze_targets || []).map(gaze => `
                <div class="gesture-pill" data-gaze="${gaze}">${gaze}</div>
            `).join('')}
        </div>

        <div class="section-header" style="margin-top:16px;">
            <span class="section-title">Director Animation State</span>
        </div>
        <div class="gesture-pill-grid">
            ${['idle', 'listening', 'thinking', 'speaking', 'working'].map(st => `
                <div class="gesture-pill" data-state="${st}">${st}</div>
            `).join('')}
        </div>
    `;

    container.appendChild(sec);

    sec.querySelectorAll('.gesture-pill[data-gaze]').forEach(pill => {
        pill.addEventListener('click', () => {
            window.anna.cue({ gaze: pill.dataset.gaze });
            sec.querySelectorAll('.gesture-pill[data-gaze]').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
        });
    });

    sec.querySelectorAll('.gesture-pill[data-state]').forEach(pill => {
        pill.addEventListener('click', () => {
            if (_director) _director.animationState = pill.dataset.state;
            sec.querySelectorAll('.gesture-pill[data-state]').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
        });
    });
}

function _renderLayersTab(container) {
    const sec = document.createElement('div');
    sec.className = 'studio-section';
    sec.innerHTML = `
        <div class="section-header">
            <span class="section-title">Procedural Avatar Layers</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;" id="layers-list">
            ${Object.keys(avatarLayers).map(lName => `
                <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer;">
                    <input type="checkbox" data-layer="${lName}" ${avatarLayers[lName] ? 'checked' : ''}>
                    ${lName.toUpperCase()} LAYER
                </label>
            `).join('')}
        </div>
    `;
    container.appendChild(sec);

    sec.querySelectorAll('input[data-layer]').forEach(chk => {
        chk.addEventListener('change', (e) => {
            toggleLayer(chk.dataset.layer);
            if (window.anna && window.anna.toggleLayer) {
                window.anna.toggleLayer(chk.dataset.layer);
            }
        });
    });
}

function _renderLiveTab(container) {
    const sec = document.createElement('div');
    sec.className = 'studio-section';
    sec.innerHTML = `
        <div class="section-header">
            <span class="section-title">Live Speech Simulation</span>
        </div>
        <div style="display:flex; gap:8px;">
            <button class="studio-action-btn primary" id="btn-sim-speech">Simulate Speaking (Onset)</button>
            <button class="studio-action-btn" id="btn-copy-live-json">Copy Library JSON</button>
        </div>
        <div style="margin-top:14px;">
            <span class="section-title">Inspector JSON</span>
            <pre style="background:#090c12; padding:8px; border-radius:6px; font-size:10px; max-height:220px; overflow:auto; margin-top:6px;" id="live-json-dump">
${JSON.stringify(_studio.library[_studio.selectedGesture], null, 2)}
            </pre>
        </div>
    `;
    container.appendChild(sec);

    sec.querySelector('#btn-sim-speech')?.addEventListener('click', () => {
        if (_gestureEngine) {
            _gestureEngine.trigger(_studio.selectedGesture, 0.8, 'auto', { force: true });
        }
    });

    sec.querySelector('#btn-copy-live-json')?.addEventListener('click', _copyLibraryJSON);
}

function _applyLiveKeyframeEdit(label = 'Edit') {
    _history.push(_studio.library, label);
    _rebuildPlayer();

    // Re-evaluate current playhead
    if (_gestureEngine?.debug) {
        _seekTimeline(_gestureEngine.debug.t);
    }
}

function _syncKeyframeInputs() {
    const prog = _studio.library[_studio.selectedGesture];
    if (!prog || !prog.keys) return;

    const side = _getActiveEditSide();
    const key = (!_studio.linkHands && prog.overrides?.[side]?.keys)
        ? prog.overrides[side].keys[_studio.selectedKeyIndex]
        : prog.keys[_studio.selectedKeyIndex];
    if (!key) return;

    const card = document.querySelector(`.keyframe-card[data-index="${_studio.selectedKeyIndex}"]`);
    if (!card) return;

    card.querySelectorAll('.coord-slider, .coord-num-input').forEach(input => {
        const axis = parseInt(input.dataset.axis);
        if (!isNaN(axis) && key.pos) input.value = key.pos[axis];
    });

    _updateGizmoProxyPosition();
}

function _createNewGesture() {
    const name = prompt('Enter new gesture name:');
    if (!name || _studio.library[name]) {
        if (_studio.library[name]) alert(`Gesture '${name}' already exists.`);
        return;
    }

    _studio.library[name] = {
        lead: 'dominant',
        pole: 'elbow_down',
        keys: [
            { t: [0.25, 0.35], pos: [0.35, -0.65, 0.70], palm: 'inward', shape: 'soft_open', shoulderLift: 0 }
        ],
        hold: [0.25, 0.45],
        release: 'LIVE_IDLE'
    };

    _markUnsaved();
    _history.push(_studio.library, `Create gesture '${name}'`);
    _selectGesture(name);
}

function _duplicateGesture() {
    const cur = _studio.selectedGesture;
    const name = prompt(`Duplicate '${cur}' as:`, `${cur}_copy`);
    if (!name || _studio.library[name]) return;

    _studio.library[name] = JSON.parse(JSON.stringify(_studio.library[cur]));
    _markUnsaved();
    _history.push(_studio.library, `Duplicate gesture '${cur}'`);
    _selectGesture(name);
}

function _deleteGesture() {
    const cur = _studio.selectedGesture;
    if (Object.keys(_studio.library).length <= 1) {
        alert('Cannot delete the last gesture.');
        return;
    }
    if (!confirm(`Are you sure you want to delete '${cur}'?`)) return;

    delete _studio.library[cur];
    _markUnsaved();
    _history.push(_studio.library, `Delete gesture '${cur}'`);
    _selectGesture(Object.keys(_studio.library)[0]);
}

function _addKeyframe() {
    const prog = _studio.library[_studio.selectedGesture];
    if (!prog) return;

    const lastKey = prog.keys[prog.keys.length - 1];
    const newKey = {
        t: [0.18, 0.25],
        pos: [...(lastKey?.pos || [0.3, -0.6, 0.7])],
        palm: lastKey?.palm || 'inward',
        shape: lastKey?.shape || 'soft_open',
        shoulderLift: lastKey?.shoulderLift || 0
    };

    if (_studio.linkHands) {
        prog.keys.push(newKey);
        if (prog.overrides?.left?.keys) prog.overrides.left.keys.push(JSON.parse(JSON.stringify(newKey)));
        if (prog.overrides?.right?.keys) prog.overrides.right.keys.push(JSON.parse(JSON.stringify(newKey)));
    } else {
        const side = _getActiveEditSide();
        if (!prog.overrides) prog.overrides = {};
        if (!prog.overrides[side]) {
            prog.overrides[side] = { keys: JSON.parse(JSON.stringify(prog.keys)) };
        }
        prog.overrides[side].keys.push(newKey);
    }

    _markUnsaved();
    _applyLiveKeyframeEdit('Add keyframe');
    _selectKeyframe(prog.keys.length - 1);
    _renderTab('gestures');
}

function _duplicateKeyframe() {
    const prog = _studio.library[_studio.selectedGesture];
    if (!prog || !prog.keys) return;

    if (_studio.linkHands) {
        const curKey = prog.keys[_studio.selectedKeyIndex];
        if (!curKey) return;
        const copy = JSON.parse(JSON.stringify(curKey));
        prog.keys.splice(_studio.selectedKeyIndex + 1, 0, copy);
        if (prog.overrides?.left?.keys) {
            prog.overrides.left.keys.splice(_studio.selectedKeyIndex + 1, 0, JSON.parse(JSON.stringify(prog.overrides.left.keys[_studio.selectedKeyIndex] || copy)));
        }
        if (prog.overrides?.right?.keys) {
            prog.overrides.right.keys.splice(_studio.selectedKeyIndex + 1, 0, JSON.parse(JSON.stringify(prog.overrides.right.keys[_studio.selectedKeyIndex] || copy)));
        }
    } else {
        const side = _getActiveEditSide();
        if (!prog.overrides) prog.overrides = {};
        if (!prog.overrides[side]) {
            prog.overrides[side] = { keys: JSON.parse(JSON.stringify(prog.keys)) };
        }
        const curKey = prog.overrides[side].keys[_studio.selectedKeyIndex];
        if (!curKey) return;
        const copy = JSON.parse(JSON.stringify(curKey));
        prog.overrides[side].keys.splice(_studio.selectedKeyIndex + 1, 0, copy);
    }

    _markUnsaved();
    _applyLiveKeyframeEdit('Duplicate keyframe');
    _selectKeyframe(_studio.selectedKeyIndex + 1);
    _renderTab('gestures');
}

function _deleteKeyframe() {
    const prog = _studio.library[_studio.selectedGesture];
    if (!prog || !prog.keys || prog.keys.length <= 1) {
        alert('A gesture must have at least one keyframe.');
        return;
    }

    if (_studio.linkHands) {
        prog.keys.splice(_studio.selectedKeyIndex, 1);
        if (prog.overrides?.left?.keys && prog.overrides.left.keys.length > 1) {
            prog.overrides.left.keys.splice(_studio.selectedKeyIndex, 1);
        }
        if (prog.overrides?.right?.keys && prog.overrides.right.keys.length > 1) {
            prog.overrides.right.keys.splice(_studio.selectedKeyIndex, 1);
        }
    } else {
        const side = _getActiveEditSide();
        if (prog.overrides?.[side]?.keys && prog.overrides[side].keys.length > 1) {
            prog.overrides[side].keys.splice(_studio.selectedKeyIndex, 1);
        } else {
            prog.keys.splice(_studio.selectedKeyIndex, 1);
        }
    }

    _studio.selectedKeyIndex = Math.max(0, _studio.selectedKeyIndex - 1);
    _markUnsaved();
    _applyLiveKeyframeEdit('Delete keyframe');
    _renderTab('gestures');
}

function _toggleSnapshotA() {
    if (!_studio.snapshotA) {
        _studio.snapshotA = JSON.parse(JSON.stringify(_studio.library[_studio.selectedGesture]));
        _studio.isShowingSnapshotA = true;
        _showToast('Snapshot A saved');
    } else {
        _studio.isShowingSnapshotA = !_studio.isShowingSnapshotA;
        if (_studio.isShowingSnapshotA) {
            _studio.library[_studio.selectedGesture] = JSON.parse(JSON.stringify(_studio.snapshotA));
            _showToast('Viewing Snapshot A');
        } else {
            // Restore live
            _studio.library = JSON.parse(JSON.stringify(_history.undoStack[_history.undoStack.length - 1].state));
            _showToast('Viewing Live B');
        }
    }
    _rebuildPlayer();
    _renderTab('gestures');
}

function _undo() {
    if (!_history.canUndo()) return;
    const restored = _history.undo();
    if (restored) {
        _studio.library = restored;
        _rebuildPlayer();
        _renderTab(_studio.activeTab);
        _markUnsaved();
        _showToast('Undo');
    }
}

function _redo() {
    if (!_history.canRedo()) return;
    const restored = _history.redo();
    if (restored) {
        _studio.library = restored;
        _rebuildPlayer();
        _renderTab(_studio.activeTab);
        _markUnsaved();
        _showToast('Redo');
    }
}

function _revertGesture() {
    if (!confirm(`Revert '${_studio.selectedGesture}' to defaults?`)) return;
    if (GESTURE_LIBRARY[_studio.selectedGesture]) {
        _studio.library[_studio.selectedGesture] = JSON.parse(JSON.stringify(GESTURE_LIBRARY[_studio.selectedGesture]));
        _markUnsaved();
        _applyLiveKeyframeEdit('Revert gesture');
        _renderTab('gestures');
        _showToast('Reverted');
    }
}

// ═══════════════════════════════════════════════════
//  PERSISTENCE & PROJECT SAVE
// ═══════════════════════════════════════════════════

async function _saveToProject() {
    const val = validateGestureLibrary({ GESTURE_LIBRARY: _studio.library, GESTURE_MODES: _studio.modes });
    if (!val.valid) {
        alert('Validation failed:\n\n' + val.errors.join('\n'));
        return;
    }

    if (val.warnings.length > 0) {
        const proceed = confirm('Validation warnings:\n\n' + val.warnings.join('\n') + '\n\nDo you want to save anyway?');
        if (!proceed) return;
    }

    try {
        const payload = {
            GESTURE_LIBRARY: _studio.library,
            GESTURE_MODES: _studio.modes
        };

        const res = await fetch('/__anna/save-gestures', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
            _studio.isUnsaved = false;
            _updateStatusChip();
            _showToast(`Saved to project! Backup in ${data.backupPath || '.anna_backups'}`);
        } else {
            alert('Failed to save: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Save error:', err);
        alert('Save request failed. Ensure Vite dev server is running.');
    }
}

function _copyCurrentGestureJSON() {
    const prog = _studio.library[_studio.selectedGesture];
    const text = JSON.stringify(prog, null, 2);
    navigator.clipboard.writeText(text);
    _showToast(`Copied '${_studio.selectedGesture}' JSON to clipboard`);
}

function _copyLibraryJSON() {
    const text = JSON.stringify({
        GESTURE_LIBRARY: _studio.library,
        GESTURE_MODES: _studio.modes
    }, null, 2);
    navigator.clipboard.writeText(text);
    _showToast('Copied entire Gesture Library JSON to clipboard');
}

function _showImportDialog() {
    const raw = prompt('Paste full Gesture Program JSON:');
    if (!raw) return;

    try {
        const parsed = JSON.parse(raw);
        const val = validateGestureProgram(_studio.selectedGesture, parsed);
        if (!val.valid) {
            alert('Invalid gesture JSON:\n\n' + val.errors.join('\n'));
            return;
        }
        _studio.library[_studio.selectedGesture] = parsed;
        _markUnsaved();
        _applyLiveKeyframeEdit('Import JSON');
        _renderTab('gestures');
        _showToast('Imported gesture JSON successfully');
    } catch (e) {
        alert('JSON parse error: ' + e.message);
    }
}

function _showShortcutsHelp() {
    const modal = document.createElement('div');
    modal.className = 'studio-modal-backdrop';
    modal.innerHTML = `
        <div class="studio-modal">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <span style="font-weight:700; font-size:14px;">Keyboard Shortcuts</span>
                <button class="coord-nudge-btn" id="btn-close-modal">✕</button>
            </div>
            <div class="shortcut-row"><span>Play / Pause</span><span class="shortcut-key">Space</span></div>
            <div class="shortcut-row"><span>Step Frame</span><span class="shortcut-key">← / →</span></div>
            <div class="shortcut-row"><span>Prev / Next Keyframe</span><span class="shortcut-key">[ / ]</span></div>
            <div class="shortcut-row"><span>Toggle Loop</span><span class="shortcut-key">L</span></div>
            <div class="shortcut-row"><span>Reset to Rest</span><span class="shortcut-key">R</span></div>
            <div class="shortcut-row"><span>Fire from Start</span><span class="shortcut-key">F</span></div>
            <div class="shortcut-row"><span>Save to Project</span><span class="shortcut-key">Ctrl + S</span></div>
            <div class="shortcut-row"><span>Undo / Redo</span><span class="shortcut-key">Ctrl+Z / Ctrl+Shift+Z</span></div>
            <div class="shortcut-row"><span>Quick Load Gesture</span><span class="shortcut-key">1 - 9</span></div>
        </div>
    `;
    modal.querySelector('#btn-close-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
}

function _showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'studio-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
}

function _handleKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        return;
    }

    if (e.ctrlKey || e.metaKey) {
        if (e.key === 's' || e.key === 'S') {
            e.preventDefault();
            _saveToProject();
            return;
        }
        if (e.key === 'z' || e.key === 'Z') {
            e.preventDefault();
            if (e.shiftKey) _redo();
            else _undo();
            return;
        }
    }

    if (e.key === ' ') {
        e.preventDefault();
        _togglePlayPause();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        _stepFrame(-1);
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        _stepFrame(1);
    } else if (e.key === '[') {
        _jumpKeyframe(-1);
    } else if (e.key === ']') {
        _jumpKeyframe(1);
    } else if (e.key === 'l' || e.key === 'L') {
        _toggleLoop();
    } else if (e.key === 'r' || e.key === 'R') {
        _resetEngine();
    } else if (e.key === 'f' || e.key === 'F') {
        _seekTimeline(0);
        if (_gestureEngine?.debug) _gestureEngine.debug.paused = false;
    } else if (e.key === '?') {
        _showShortcutsHelp();
    } else if (e.key >= '1' && e.key <= '9') {
        const names = Object.keys(_studio.library);
        const idx = parseInt(e.key) - 1;
        if (names[idx]) _selectGesture(names[idx]);
    } else if (e.key === 'F2') {
        e.preventDefault();
        if (!_isStudioMode) _toggleCompactToolbar();
    }
}

// ═══════════════════════════════════════════════════
//  COMPACT F2 TOOLBAR (Normal App Mode)
// ═══════════════════════════════════════════════════

let _compactToolbarEl = null;

function _initCompactMode() {
    _createCompactToolbar();
}

function _createCompactToolbar() {
    if (_compactToolbarEl) return;

    _compactToolbarEl = document.createElement('div');
    _compactToolbarEl.id = 'anna-compact-toolbar';
    _compactToolbarEl.style.display = 'none';

    _compactToolbarEl.innerHTML = `
        <div class="compact-toolbar-header" id="compact-drag-header">
            <span>🛠️ Gesture Quick Tool</span>
            <button class="coord-nudge-btn" id="compact-btn-close">✕</button>
        </div>
        <div class="compact-toolbar-body">
            <select class="studio-select" id="compact-gesture-select">
                ${Object.keys(GESTURE_LIBRARY).map(g => `<option value="${g}">${g}</option>`).join('')}
            </select>
            <div class="compact-row">
                <button class="studio-action-btn primary" id="compact-btn-fire" style="flex:1;">▶ Fire</button>
                <button class="studio-action-btn" id="compact-btn-pause" style="flex:1;">⏸ Pause</button>
                <button class="studio-action-btn" id="compact-btn-reset" style="flex:1;">↺ Reset</button>
            </div>
            <button class="studio-action-btn" id="compact-btn-open-studio" style="width:100%; justify-content:center;">
                Open Studio ↗
            </button>
        </div>
    `;

    document.body.appendChild(_compactToolbarEl);

    _compactToolbarEl.querySelector('#compact-btn-close')?.addEventListener('click', () => {
        _compactToolbarEl.style.display = 'none';
    });

    _compactToolbarEl.querySelector('#compact-btn-fire')?.addEventListener('click', () => {
        const sel = _compactToolbarEl.querySelector('#compact-gesture-select').value;
        if (_gestureEngine) _gestureEngine.trigger(sel, 0.8, 'auto', { force: true });
    });

    _compactToolbarEl.querySelector('#compact-btn-pause')?.addEventListener('click', () => {
        if (_gestureEngine) _gestureEngine.freeze(!_gestureEngine.isFrozen);
    });

    _compactToolbarEl.querySelector('#compact-btn-reset')?.addEventListener('click', () => {
        if (_gestureEngine) _gestureEngine.resetToIdle();
    });

    _compactToolbarEl.querySelector('#compact-btn-open-studio')?.addEventListener('click', () => {
        window.open('/?studio=1', '_blank');
    });

    // Drag handler for compact toolbar
    const header = _compactToolbarEl.querySelector('#compact-drag-header');
    let isDragging = false, startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

    header.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = _compactToolbarEl.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        _compactToolbarEl.style.left = `${initialLeft + (e.clientX - startX)}px`;
        _compactToolbarEl.style.top = `${initialTop + (e.clientY - startY)}px`;
        _compactToolbarEl.style.right = 'auto';
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

function _toggleCompactToolbar() {
    if (!_compactToolbarEl) _createCompactToolbar();
    const isVisible = _compactToolbarEl.style.display !== 'none';
    _compactToolbarEl.style.display = isVisible ? 'none' : 'block';
}

function _updateLayersUI() {
    document.querySelectorAll('input[data-layer]').forEach(chk => {
        chk.checked = !!_layers[chk.dataset.layer];
    });
}

// ═══════════════════════════════════════════════════
//  UPDATE LOOP (Called per frame from renderer.js)
// ═══════════════════════════════════════════════════

export function updateDebugOverlay(director, gestureEngine, armLayer) {
    if (_isStudioMode) {
        if (_orbitControls) _orbitControls.update();
        _updateTimelinePlayhead();
        _updateLiveHUD(gestureEngine, armLayer);
    }
    if (_gizmosInstance) {
        _gizmosInstance.update(armLayer, gestureEngine);
    }
}

function _updateLiveHUD(gestureEngine, armLayer) {
    const armSide = _studio.hudArm;
    const handState = (armSide === 'left') ? gestureEngine?.left : gestureEngine?.right;
    const d = armLayer?.debugPositions;
    if (!handState || !d) return;

    const shoulder = (armSide === 'left') ? d.leftShoulder : d.rightShoulder;
    const elbow = (armSide === 'left') ? d.leftElbow : d.rightElbow;
    const target = (armSide === 'left') ? d.leftTarget : d.rightTarget;

    const distST = shoulder.distanceTo(target);
    const R = avatarLandmarks.R || 0.48;
    const ratio = distST / R;

    // Reach Bar
    const hudValReach = document.getElementById('hud-val-reach');
    const hudPointer = document.getElementById('hud-reach-pointer');
    if (hudValReach) {
        hudValReach.textContent = `${distST.toFixed(2)}m / ${R.toFixed(2)}m (${Math.round(ratio * 100)}%)`;
    }
    if (hudPointer) {
        hudPointer.style.left = `${Math.min(100, Math.max(0, ratio * 100))}%`;
    }

    // Interior Elbow Angle
    const vSE = new THREE.Vector3().subVectors(shoulder, elbow).normalize();
    const vTE = new THREE.Vector3().subVectors(target, elbow).normalize();
    const dot = Math.max(-1, Math.min(1, vSE.dot(vTE)));
    const angleDeg = Math.acos(dot) * (180.0 / Math.PI);

    const hudValElbow = document.getElementById('hud-val-elbow');
    if (hudValElbow) hudValElbow.textContent = `${angleDeg.toFixed(1)}°`;

    // Badges & Warnings
    const badgesContainer = document.getElementById('hud-badges-container');
    if (badgesContainer) {
        badgesContainer.innerHTML = '';

        if (angleDeg > 155) {
            badgesContainer.innerHTML += '<span class="hud-badge badge-warn">Straight Arm (>155°)</span>';
        } else if (angleDeg < 35) {
            badgesContainer.innerHTML += '<span class="hud-badge badge-warn">Collapsed Elbow (<35°)</span>';
        }

        // Soft limiter
        const minReach = R * 0.35;
        const maxReach = R * 0.94;
        const hudValSoft = document.getElementById('hud-val-soft');

        if (distST > maxReach) {
            const comp = ((distST - maxReach) * 100).toFixed(1);
            if (hudValSoft) hudValSoft.textContent = `Active (+${comp} cm)`;
            badgesContainer.innerHTML += `<span class="hud-badge badge-warn">Soft Limiter (${comp}cm)</span>`;
        } else if (distST < minReach) {
            const comp = ((minReach - distST) * 100).toFixed(1);
            if (hudValSoft) hudValSoft.textContent = `Active (-${comp} cm)`;
            badgesContainer.innerHTML += `<span class="hud-badge badge-warn">Near Body (${comp}cm)</span>`;
        } else {
            if (hudValSoft) hudValSoft.textContent = 'Inactive';
        }

        // Torso / Head clearance
        const tc = avatarLandmarks.torsoCenter || { x: 0, y: 1.05, z: 0 };
        const tr = avatarLandmarks.torsoRadii || { x: 0.16, y: 0.22, z: 0.14 };
        const ellDist = Math.sqrt(
            Math.pow((target.x - tc.x) / tr.x, 2) +
            Math.pow((target.y - tc.y) / tr.y, 2) +
            Math.pow((target.z - tc.z) / tr.z, 2)
        );

        if (ellDist < 1.0) {
            badgesContainer.innerHTML += '<span class="hud-badge badge-alert">Inside Torso</span>';
        }

        badgesContainer.innerHTML += `<span class="hud-badge badge-ok">${handState.phase}</span>`;
    }
}

export function buildModelReport(vrm) {
    _modelReport = { vrm };
    return _modelReport;
}

export function setModelReport(report) {
    _modelReport = report;
}
