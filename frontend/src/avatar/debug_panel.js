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
import { evaluateClip, mirrorQuaternion, mirrorBoneName, validateClip } from './clip_evaluator.js';
import { clipLayer as defaultClipLayer } from './clip_layer.js';
import { SkeletonOverlay, ViewportShading, ALL_HUMANOID_BONES } from './studio_viewport.js';
import { AnimEditor, BONE_GROUPS } from './studio_anim_editor.js';
import { StudioOutliner } from './studio_outliner.js';
import { StudioDopeSheet } from './studio_dopesheet.js';
import { applyVariation } from './studio_variation.js';
import {
    capturePose, applyPose, mirrorPose, resetBones, resetAllBones,
    getModifiedBones, loadPoseLibrary, savePoseToLibrary, deletePoseFromLibrary
} from './studio_pose_tools.js';

// ── State variables ──
let _director = null;
let _scene = null;
let _gestureEngine = null;
let _armLayer = null;
let _renderer3D = null;
let _camera = null;
let _vrm = null;
let _clipLayer = defaultClipLayer;

let _orbitControls = null;
let _transformControls = null;
let _transformControlsR = null;
let _gizmoProxyR = null;
let _transformControlsL = null;
let _gizmoProxyL = null;
let _gizmoProxy = null;
let _transformControlsBone = null;
let _transformControlsBoneHelper = null;
let _transformControlsRHelper = null;
let _transformControlsLHelper = null;
let _lastAttachedBoneName = null;
let _isTransformDragging = false;

// Blender Studio components
let _skeletonOverlay = null;
let _viewportShading = null;
let _animEditor = null;
let _studioOutliner = null;
let _studioDopeSheet = null;

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
    selectedBone: 'head',
    boneSpace: 'local',
    boneSnap: 0,
    boneGizmoMode: 'rotate', // 'rotate' | 'translate'
    lockedAxis: null,        // null | 'X' | 'Y' | 'Z'
    selectedClipName: 'nod_curious',
    clipsList: [],
    activeClipData: {
        name: 'nod_curious',
        duration: 1.2,
        loop: false,
        holdUntilReleased: false,
        tracks: {
            head: [
                { t: 0.0, rot: [0, 0, 0, 1], interp: 'smooth' },
                { t: 0.4, rot: [0.08, 0.05, -0.02, 0.99], interp: 'smooth' },
                { t: 1.2, rot: [0, 0, 0, 1], interp: 'smooth' }
            ]
        }
    },
    clipPlayheadTime: 0.0,
    clipIsPlaying: false,
    selectedClipKeyIdx: -1,
    selectedInterp: 'smooth',
    boneSearchQuery: '',
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
export function initDebug(director, scene = null, gestureEngine = null, armLayer = null, renderer = null, camera = null, vrm = null, clipLayer = null) {
    _director = director;
    _scene = scene;
    _gestureEngine = gestureEngine;
    _armLayer = armLayer;
    _renderer3D = renderer;
    _camera = camera;
    _vrm = vrm;
    if (clipLayer) _clipLayer = clipLayer;

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

    // Initialize Blender Studio subsystems
    if (_isStudioMode && _scene && _camera && _renderer3D) {
        _viewportShading = new ViewportShading(_renderer3D, _scene);
        _skeletonOverlay = new SkeletonOverlay(_scene, _camera, _renderer3D.domElement);
        if (_vrm) _skeletonOverlay.setVRM(_vrm);

        _skeletonOverlay.onSelect = (boneName, e) => {
            if (boneName) {
                if (_studioOutliner?.isLocked(boneName)) return;
                _studio.selectedBone = boneName;
                _animEditor?.setSelectedBones(_skeletonOverlay.selectedBones);
                _studioOutliner?.setSelection(_skeletonOverlay.selectedBones);
                _attachBoneGizmo();
            } else {
                _animEditor?.setSelectedBones([]);
                _studioOutliner?.setSelection([]);
                _attachBoneGizmo();
            }
            _updateNumericPanelUI();
            _studioDopeSheet?.refresh();
        };

        _animEditor = new AnimEditor({
            vrm: _vrm,
            history: _history,
            clipLayer: _clipLayer,
            skeletonOverlay: _skeletonOverlay,
            onClipChange: () => {
                _updateSkeletonKeyedBones();
                _studioDopeSheet?.refresh();
                _updateNumericPanelUI();
            }
        });
    }

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
                <div class="toolbar-divider"></div>
                <button class="studio-camera-btn active" id="btn-shade-solid" title="Solid Shading">Solid</button>
                <button class="studio-camera-btn" id="btn-shade-wire" title="Wireframe Shading">Wireframe</button>
                <button class="studio-camera-btn" id="btn-shade-xray" title="X-Ray (Mesh See-Through)">X-Ray</button>
                <button class="studio-camera-btn active" id="btn-toggle-skel" title="Toggle Skeleton Overlay">Skeleton</button>
                <button class="studio-camera-btn" id="btn-frame-sel" title="Frame Selected Bone (F)">Frame [F]</button>
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

            <!-- Drag handle to resize timeline (sibling so dopesheet innerHTML won't erase it) -->
            <div id="timeline-drag-handle" class="timeline-resizer" title="Drag to resize timeline"></div>

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
                <button class="studio-tab-btn active" data-tab="gestures">Gestures &amp; Animation</button>
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
    _renderTab(_studio.activeTab);

    // 9. Select initial gesture for secondary tab
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
    _transformControlsRHelper = _transformControlsR.getHelper();
    _scene.add(_transformControlsRHelper);
    _transformControlsRHelper.traverse(child => {
        if (child.material) { child.material.depthTest = false; child.material.depthWrite = false; child.renderOrder = 9999; }
    });
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
    _transformControlsLHelper = _transformControlsL.getHelper();
    _scene.add(_transformControlsLHelper);
    _transformControlsLHelper.traverse(child => {
        if (child.material) { child.material.depthTest = false; child.material.depthWrite = false; child.renderOrder = 9999; }
    });
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

    // TransformControls for Bone rotation (Blender-style bone editor)
    _transformControlsBone = new TransformControls(_camera, _renderer3D.domElement);
    _transformControlsBone.setMode('rotate');
    _transformControlsBone.size = 0.75;
    _transformControlsBone.space = _studio.boneSpace || 'local';
    _transformControlsBone.visible = false;
    _transformControlsBone.enabled = false;
    _transformControlsBoneHelper = _transformControlsBone.getHelper();
    _scene.add(_transformControlsBoneHelper);
    _transformControlsBoneHelper.traverse(child => {
        if (child.material) { child.material.depthTest = false; child.material.depthWrite = false; child.renderOrder = 9999; }
    });

    _transformControlsBone.addEventListener('dragging-changed', (e) => {
        _isTransformDragging = !!e.value;
        if (_orbitControls) _orbitControls.enabled = !e.value;
        if (!e.value && _animEditor) {
            _history.push(_animEditor.clip, `Transform ${_studio.selectedBone}`);
        }
    });

    _transformControlsBone.addEventListener('change', () => {
        if (_isTransformDragging) {
            _onBoneGizmoDrag();
        }
    });

    // Fetch saved clips from backend
    if (typeof fetch !== 'undefined') {
        fetch('/__anna/list-clips')
            .then(res => res.json())
            .then(data => {
                if (data.clips && data.clips.length > 0) {
                    _studio.clipsList = data.clips;
                    data.clips.forEach(c => _clipLayer?.registerClip(c.name, c));
                }
            })
            .catch(() => { });
    }

    // Camera toolbar preset buttons
    document.querySelectorAll('.studio-camera-btn[data-cam]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.studio-camera-btn[data-cam]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _setCameraPreset(btn.dataset.cam);
        });
    });

    // Viewport shading buttons
    document.getElementById('btn-shade-solid')?.addEventListener('click', () => {
        _viewportShading?.setMode('solid');
        document.querySelectorAll('.studio-camera-btn[id^="btn-shade-"]').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-shade-solid')?.classList.add('active');
    });
    document.getElementById('btn-shade-wire')?.addEventListener('click', () => {
        _viewportShading?.setMode('wireframe');
        document.querySelectorAll('.studio-camera-btn[id^="btn-shade-"]').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-shade-wire')?.classList.add('active');
    });
    document.getElementById('btn-shade-xray')?.addEventListener('click', () => {
        _viewportShading?.setMode('xray');
        document.querySelectorAll('.studio-camera-btn[id^="btn-shade-"]').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-shade-xray')?.classList.add('active');
    });
    document.getElementById('btn-toggle-skel')?.addEventListener('click', (e) => {
        _skeletonOverlay?.toggle();
        e.target.classList.toggle('active', _skeletonOverlay?.visible);
    });
    document.getElementById('btn-frame-sel')?.addEventListener('click', () => {
        _frameSelectedBone();
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

    // ── Timeline Drag-Resize Handle ──
    const dragHandle = document.getElementById('timeline-drag-handle');
    const tlContainer = document.getElementById('studio-timeline-container');
    if (dragHandle && tlContainer) {
        let _dragStartY = 0;
        let _dragStartH = 0;

        const onPointerMove = (e) => {
            const delta = _dragStartY - e.clientY;
            const newH = Math.max(120, Math.min(window.innerHeight * 0.7, _dragStartH + delta));
            tlContainer.style.height = newH + 'px';
            dragHandle.classList.add('dragging');
        };

        const onPointerUp = () => {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
            dragHandle.classList.remove('dragging');
        };

        dragHandle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            _dragStartY = e.clientY;
            _dragStartH = tlContainer.offsetHeight;
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        });
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

    if (_studio.activeTab === 'gestures' || _studio.activeTab === 'animation') {
        // Attach bone gizmo if a bone is selected
        if (_studio.selectedBone) {
            if (_studio.selectedBone !== _lastAttachedBoneName) {
                _attachBoneGizmo();
            }
        } else if (_transformControlsBone) {
            _transformControlsBone.detach();
            _transformControlsBone.visible = false;
            _transformControlsBone.enabled = false;
            _lastAttachedBoneName = null;
        }

        const prog = _studio.library[_studio.selectedGesture];
        if (!prog || !prog.keys) {
            if (_transformControlsR) { _transformControlsR.visible = false; _transformControlsR.enabled = false; }
            if (_transformControlsL) { _transformControlsL.visible = false; _transformControlsL.enabled = false; }
            return;
        }

        const kIdx = _studio.selectedKeyIndex || 0;
        const handSel = _studio.selectedHand;
        const isBoth = (handSel === 'both') || (handSel === 'auto' && prog.lead === 'both');
        const isLeft = (handSel === 'left') || (handSel === 'auto' && prog.lead === 'left');
        const isRight = (handSel === 'right') || (handSel === 'auto' && prog.lead !== 'both' && prog.lead !== 'left');

        const keyR = prog.overrides?.right?.keys?.[kIdx] || prog.keys?.[kIdx];
        const keyL = prog.overrides?.left?.keys?.[kIdx] || prog.keys?.[kIdx];

        if (_transformControlsR && _gizmoProxyR) {
            if ((isBoth || isRight) && keyR && keyR.pos) {
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
            if ((isBoth || isLeft) && keyL && keyL.pos) {
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
        return;
    }

    if (_transformControlsBone) {
        _transformControlsBone.visible = false;
        _transformControlsBone.enabled = false;
        _transformControlsBone.detach();
    }
    if (_transformControlsR) { _transformControlsR.visible = false; _transformControlsR.enabled = false; }
    if (_transformControlsL) { _transformControlsL.visible = false; _transformControlsL.enabled = false; }
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
    if (!name) return;
    _studio.selectedGesture = name;

    // Ensure 'none' has a resting pose program if not in library
    if (name === 'none' && !_studio.library['none']) {
        _studio.library['none'] = {
            lead: 'dominant',
            pole: 'elbow_down',
            keys: [
                { t: [0.3, 0.3], pos: [0.20, -1.35, 0.15], palm: 'inward', shape: 'relaxed', shoulderLift: 0 }
            ],
            hold: [1.0, 1.0],
            release: 'LIVE_IDLE'
        };
    }

    const prog = _studio.library[name];
    if (prog) {
        if (prog.type === 'clip') {
            const clipData = _clipLayer?.getClip(prog.clip || name) || { name: prog.clip || name, duration: 2.0, tracks: {} };
            _animEditor?.loadClip(clipData);
        } else {
            // For IK gesture: sync into animEditor clip so timeline duration and keyframe marks reflect it
            const totalDur = prog.keys?.reduce((acc, k) => acc + (Array.isArray(k.t) ? (k.t[0] + k.t[1]) / 2 : (k.t || 0.3)), 0) || 2.0;
            if (_animEditor) {
                _animEditor.clip = {
                    name,
                    duration: Math.max(0.5, Math.round(totalDur * 100) / 100),
                    loop: !!prog.loop,
                    overrideIK: !!prog.overrideIK,
                    tracks: _animEditor.clip?.tracks && _animEditor.clip.name === name ? _animEditor.clip.tracks : {}
                };
            }
            _rebuildPlayer();
            _seekTimeline(0);
        }
    }

    _studio.selectedKeyIndex = 0;
    _renderTab(_studio.activeTab);
    _updateStatusChip();
    _studioDopeSheet?.refresh();
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
    const prog = _studio.library[_studio.selectedGesture];
    const side = _getActiveEditSide();

    // 1. Segments with resize dividers
    player.segments.forEach(seg => {
        const leftPct = (seg.t0 / totalDur) * 100;
        const widthPct = ((seg.t1 - seg.t0) / totalDur) * 100;
        const segDur = seg.t1 - seg.t0;

        const el = document.createElement('div');
        el.className = `timeline-segment seg-${seg.name.toLowerCase().replace(/#\d+/, '')}`;
        el.style.left = `${leftPct}%`;
        el.style.width = `${widthPct}%`;
        el.textContent = `${seg.name} (${segDur.toFixed(2)}s)`;
        el.title = `${seg.name} [${seg.t0.toFixed(2)}s - ${seg.t1.toFixed(2)}s] (Duration: ${segDur.toFixed(2)}s)`;

        // Segment divider resizer (draggable)
        const resizer = document.createElement('div');
        resizer.className = 'timeline-segment-resizer';
        resizer.title = `Drag right edge to adjust ${seg.name} duration`;

        resizer.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();

            resizer.classList.add('dragging');
            const startX = e.clientX;
            const startSegDur = segDur;
            const trackRect = wrapper.getBoundingClientRect();
            const trackWidth = trackRect.width || 1;
            const origTotalDur = player.duration || 1.0;

            let tooltip = document.createElement('div');
            tooltip.className = 'timeline-tooltip-bubble';
            wrapper.appendChild(tooltip);

            let lastDur = startSegDur;

            const onMouseMove = (moveEv) => {
                const deltaX = moveEv.clientX - startX;
                const deltaT = (deltaX / trackWidth) * origTotalDur;
                let newDur = Math.max(0.05, Math.min(6.0, startSegDur + deltaT));
                newDur = Math.round(newDur * 100) / 100;
                lastDur = newDur;

                const curProg = _studio.library[_studio.selectedGesture];
                if (!curProg) return;

                if (seg.name === 'PREP') {
                    _mutateKey(curProg, 0, k => { k.t = [newDur, newDur]; });
                } else if (seg.name.startsWith('STROKE#')) {
                    const idx = parseInt(seg.name.replace('STROKE#', ''));
                    if (!isNaN(idx)) {
                        _mutateKey(curProg, idx, k => { k.t = [newDur, newDur]; });
                    }
                } else if (seg.name === 'HOLD') {
                    curProg.hold = [newDur, newDur];
                } else if (seg.name === 'RETRACT') {
                    curProg.retract = [newDur, newDur];
                }

                if (_gestureEngine._setupDebugPlayers) {
                    _gestureEngine._setupDebugPlayers(curProg, _studio.selectedHand, _studio.intensity);
                }

                _renderTimelineSegments();
                _syncKeyframeTimingInputs(seg.keyIndex, newDur);

                const updatedPlayer = _gestureEngine.debug.player;
                const newTotal = updatedPlayer ? updatedPlayer.duration : origTotalDur;
                tooltip.style.left = `${((seg.t0 + newDur) / (newTotal || 1)) * 100}%`;
                tooltip.textContent = `${seg.name}: ${newDur.toFixed(2)}s (Total: ${newTotal.toFixed(2)}s)`;
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                resizer.classList.remove('dragging');
                if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);

                _history.push(_studio.library, `Resize ${seg.name} to ${lastDur}s`);
                _markUnsaved();
                _renderTab('gestures');
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });

        el.appendChild(resizer);
        wrapper.appendChild(el);
    });

    // 2. Keyframe Diamonds (with Drag to Retime)
    player.keyTargets.forEach(kt => {
        const leftPct = (kt.peakTime / totalDur) * 100;
        const diamond = document.createElement('div');
        const isSelected = (kt.keyIndex === _studio.selectedKeyIndex);
        diamond.className = `timeline-key-diamond ${isSelected ? 'selected' : ''}`;
        diamond.style.left = `${leftPct}%`;

        const curKey = (!_studio.linkHands && prog?.overrides?.[side]?.keys)
            ? prog.overrides[side].keys[kt.keyIndex]
            : prog?.keys?.[kt.keyIndex];

        const curDur = (curKey && curKey.t !== undefined)
            ? (Array.isArray(curKey.t) ? (curKey.t[0] + curKey.t[1]) / 2 : curKey.t)
            : 0.3;

        diamond.title = `Key ${kt.keyIndex} peak: ${kt.peakTime.toFixed(2)}s (Duration: ${curDur.toFixed(2)}s)\nClick to select • Drag horizontally to adjust timing`;

        diamond.addEventListener('click', (e) => {
            e.stopPropagation();
            _selectKeyframe(kt.keyIndex);
        });

        // Drag diamond horizontally to adjust duration
        diamond.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();

            _selectKeyframe(kt.keyIndex);
            diamond.classList.add('dragging');

            const startX = e.clientX;
            const startDur = curDur;
            const trackRect = wrapper.getBoundingClientRect();
            const trackWidth = trackRect.width || 1;
            const origTotalDur = player.duration || 1.0;

            let tooltip = document.createElement('div');
            tooltip.className = 'timeline-tooltip-bubble';
            wrapper.appendChild(tooltip);

            let lastDur = startDur;

            const onMouseMove = (moveEv) => {
                const deltaX = moveEv.clientX - startX;
                const deltaT = (deltaX / trackWidth) * origTotalDur;
                let newDur = Math.max(0.05, Math.min(6.0, startDur + deltaT));
                newDur = Math.round(newDur * 100) / 100;
                lastDur = newDur;

                const curProg = _studio.library[_studio.selectedGesture];
                if (!curProg) return;

                _mutateKey(curProg, kt.keyIndex, k => {
                    k.t = [newDur, newDur];
                });

                if (_gestureEngine._setupDebugPlayers) {
                    _gestureEngine._setupDebugPlayers(curProg, _studio.selectedHand, _studio.intensity);
                }

                _renderTimelineSegments();

                const newPlayer = _gestureEngine.debug.player;
                const newPeak = newPlayer ? newPlayer.getKeyPeakTime(kt.keyIndex) : kt.peakTime;
                _seekTimeline(newPeak);
                _syncKeyframeTimingInputs(kt.keyIndex, newDur);

                const newTotal = newPlayer ? newPlayer.duration : origTotalDur;
                tooltip.style.left = `${(newPeak / (newTotal || 1)) * 100}%`;
                tooltip.textContent = `Key ${kt.keyIndex}: ${newDur.toFixed(2)}s (Peak: ${newPeak.toFixed(2)}s)`;
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                diamond.classList.remove('dragging');
                if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);

                _history.push(_studio.library, `Retime Key ${kt.keyIndex} to ${lastDur}s`);
                _markUnsaved();
                _renderTab('gestures');
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });

        wrapper.appendChild(diamond);
    });

    // 3. Oscillation peak tick
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

function _syncKeyframeTimingInputs(kIdx, dur) {
    if (kIdx !== undefined && kIdx !== null) {
        const card = document.querySelector(`.keyframe-card[data-index="${kIdx}"]`);
        if (card) {
            const durSlider = card.querySelector('.key-dur-slider');
            const durNum = card.querySelector('.key-dur-num');
            const durDisp = card.querySelector('.key-dur-display');
            if (durSlider && dur !== undefined) durSlider.value = dur;
            if (durNum && dur !== undefined && document.activeElement !== durNum) durNum.value = dur;
            if (durDisp && dur !== undefined) durDisp.textContent = `${dur.toFixed(2)}s`;
        }
    }
    const prog = _studio.library[_studio.selectedGesture];
    if (prog) {
        const holdSlider = document.getElementById('setting-hold-slider');
        const holdNum = document.getElementById('setting-hold-num');
        if (holdSlider && prog.hold !== undefined) {
            const h = Array.isArray(prog.hold) ? (prog.hold[0] + prog.hold[1]) / 2 : prog.hold;
            holdSlider.value = h;
            if (holdNum && document.activeElement !== holdNum) holdNum.value = h;
        }
        const retractSlider = document.getElementById('setting-retract-slider');
        const retractNum = document.getElementById('setting-retract-num');
        if (retractSlider && prog.retract !== undefined) {
            const r = Array.isArray(prog.retract) ? (prog.retract[0] + prog.retract[1]) / 2 : prog.retract;
            retractSlider.value = r;
            if (retractNum && document.activeElement !== retractNum) retractNum.value = r;
        }
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
    } catch (e) { }
}

// ═══════════════════════════════════════════════════
//  STUDIO TABS RENDERING
// ═══════════════════════════════════════════════════

function _renderTab(tabName) {
    const container = document.getElementById('studio-tab-body');
    if (!container) return;
    container.innerHTML = '';

    _updateGizmoProxyPosition();

    switch (tabName) {
        case 'animation':
            _renderGesturesTab(container);
            break;
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

// ═══════════════════════════════════════════════════
//  BLENDER-STYLE BONE EDITOR & DOPE SHEET
// ═══════════════════════════════════════════════════

const BONE_CATEGORIES = {
    'Head & Neck': ['head', 'neck'],
    'Spine & Torso': ['hips', 'spine', 'chest', 'upperChest'],
    'Left Arm & Hand': [
        'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
        'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
        'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
        'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
        'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
        'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal'
    ],
    'Right Arm & Hand': [
        'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
        'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
        'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
        'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
        'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
        'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'
    ]
};

function _attachBoneGizmo() {
    if (!_transformControlsBone) return;
    if (_studio.activeTab !== 'animation' && _studio.activeTab !== 'gestures') {
        _transformControlsBone.visible = false;
        _transformControlsBone.enabled = false;
        _transformControlsBone.detach();
        _lastAttachedBoneName = null;
        return;
    }
    const boneName = _studio.selectedBone;
    if (!boneName || _studioOutliner?.isLocked(boneName)) {
        _transformControlsBone.detach();
        _transformControlsBone.visible = false;
        _transformControlsBone.enabled = false;
        _lastAttachedBoneName = null;
        return;
    }
    const node = _vrm?.humanoid?.getNormalizedBoneNode(boneName);
    if (node) {
        _transformControlsBone.attach(node);
        _lastAttachedBoneName = boneName;
        _transformControlsBone.space = _studio.boneSpace || 'local';
        _transformControlsBone.setMode(_studio.boneGizmoMode || 'rotate');
        _transformControlsBone.visible = true;
        _transformControlsBone.enabled = true;
        _updateNumericPanelUI();
    } else {
        _transformControlsBone.detach();
        _transformControlsBone.visible = false;
        _transformControlsBone.enabled = false;
        _lastAttachedBoneName = null;
    }
}

function _onBoneGizmoDrag() {
    const bone = _studio.selectedBone;
    if (!bone) return;
    const node = _vrm?.humanoid?.getNormalizedBoneNode(bone);
    if (!node) return;
    _animEditor?.setBoneQuaternion(bone, node.quaternion);
    _updateNumericPanelUI();
    if (_animEditor?.autoKey) {
        _animEditor.insertKeyframe([bone]);
        _updateSkeletonKeyedBones();
        _studioDopeSheet?.refresh();
        _studioOutliner?.setKeyedBones(new Set(Object.keys(_animEditor.clip?.tracks || {})));
    }
}

function _updateNumericPanelUI() {
    const bone = _studio.selectedBone;
    const titleEl = document.getElementById('selected-bone-name-display');
    if (titleEl) titleEl.textContent = bone || 'None';

    if (!bone || !_animEditor) return;
    const euler = _animEditor.getBoneEulerDeg(bone);

    const elX = document.getElementById('euler-rot-x');
    const elY = document.getElementById('euler-rot-y');
    const elZ = document.getElementById('euler-rot-z');
    if (elX && document.activeElement !== elX) elX.value = euler.x;
    if (elY && document.activeElement !== elY) elY.value = euler.y;
    if (elZ && document.activeElement !== elZ) elZ.value = euler.z;
}

function _updateSkeletonKeyedBones() {
    if (!_skeletonOverlay || !_animEditor) return;
    const keyedSet = new Set(Object.keys(_animEditor.clip?.tracks || {}));
    _skeletonOverlay.setKeyedBones(keyedSet);
}

function _selectBoneInStudio(boneName, additive = false) {
    if (!boneName) {
        _studio.selectedBone = '';
        _animEditor?.setSelectedBones([]);
        _skeletonOverlay?.deselectAll();
        _studioOutliner?.setSelection([]);
        _attachBoneGizmo();
        _updateNumericPanelUI();
        return;
    }

    if (additive && _animEditor) {
        const cur = new Set(_animEditor.selectedBones);
        if (cur.has(boneName)) cur.delete(boneName);
        else cur.add(boneName);
        _studio.selectedBone = boneName;
        _animEditor.setSelectedBones(cur);
        _skeletonOverlay?.setSelectedBones(cur);
        _studioOutliner?.setSelection(cur);
    } else {
        _studio.selectedBone = boneName;
        const set = new Set([boneName]);
        _animEditor?.setSelectedBones(set);
        _skeletonOverlay?.setSelectedBones(set);
        _studioOutliner?.setSelection(set);
    }

    _attachBoneGizmo();
    _updateNumericPanelUI();
}

function _frameSelectedBone() {
    if (!_camera || !_orbitControls || !_vrm?.humanoid) return;
    const boneName = _studio.selectedBone;
    if (!boneName) return;
    const node = _vrm.humanoid.getNormalizedBoneNode(boneName);
    if (!node) return;
    const targetPos = new THREE.Vector3();
    node.getWorldPosition(targetPos);
    _orbitControls.target.copy(targetPos);
    _orbitControls.update();
}

function _cycleShadingMode() {
    if (!_viewportShading) return;
    const modes = ['solid', 'wireframe', 'xray'];
    const cur = _viewportShading.getMode();
    const next = modes[(modes.indexOf(cur) + 1) % modes.length];
    _viewportShading.setMode(next);
    document.querySelectorAll('.btn-shading, .studio-camera-btn[id^="btn-shade-"]').forEach(btn => {
        btn.classList.toggle('active', btn.id === `btn-shade-${next}` || btn.dataset?.shading === next);
    });
}

function _toggleGizmoAxis(axis) {
    if (!_transformControlsBone) return;
    if (_studio.lockedAxis === axis) {
        _studio.lockedAxis = null;
        _transformControlsBone.showX = true;
        _transformControlsBone.showY = true;
        _transformControlsBone.showZ = true;
    } else {
        _studio.lockedAxis = axis;
        _transformControlsBone.showX = (axis === 'X');
        _transformControlsBone.showY = (axis === 'Y');
        _transformControlsBone.showZ = (axis === 'Z');
    }
}

function _mirrorSelectedBone() {
    const srcBone = _studio.selectedBone;
    const tgtBone = mirrorBoneName(srcBone);
    if (srcBone === tgtBone) return;
    const srcNode = _vrm?.humanoid?.getNormalizedBoneNode(srcBone);
    const tgtNode = _vrm?.humanoid?.getNormalizedBoneNode(tgtBone);
    if (!srcNode || !tgtNode) return;

    const qMirrored = mirrorQuaternion([srcNode.quaternion.x, srcNode.quaternion.y, srcNode.quaternion.z, srcNode.quaternion.w]);
    tgtNode.quaternion.set(qMirrored[0], qMirrored[1], qMirrored[2], qMirrored[3]);

    if (_animEditor?.autoKey) {
        _animEditor.insertKeyframe([tgtBone]);
        _updateSkeletonKeyedBones();
        _studioDopeSheet?.refresh();
    }
    _selectBoneInStudio(tgtBone);
}

function _renderPoseLibraryList(container) {
    if (!container) return;
    container.innerHTML = '';
    const lib = loadPoseLibrary();
    const entries = Object.entries(lib);
    if (entries.length === 0) {
        container.innerHTML = '<div style="color:var(--studio-text-muted); font-size:10px; padding:4px;">No saved poses yet.</div>';
        return;
    }
    entries.forEach(([name, pose]) => {
        const card = document.createElement('div');
        card.className = 'pose-lib-card';
        card.innerHTML = `
            <div class="pose-lib-card-title" title="${name}">${name}</div>
            <div class="pose-lib-card-actions">
                <button type="button" class="pose-lib-del-btn" title="Delete pose">✕</button>
            </div>
        `;
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('pose-lib-del-btn')) return;
            if (_vrm?.humanoid) {
                applyPose(_vrm.humanoid, pose);
                if (_animEditor?.autoKey) {
                    _animEditor.insertKeyframe(Object.keys(pose));
                    _updateSkeletonKeyedBones();
                    _studioDopeSheet?.refresh();
                }
                _updateNumericPanelUI();
            }
        });
        card.querySelector('.pose-lib-del-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Delete pose "${name}"?`)) {
                deletePoseFromLibrary(name);
                _renderPoseLibraryList(container);
            }
        });
        container.appendChild(card);
    });
}

function _renderAnimationTab(container) {
    if (!_animEditor) return;
    const clip = _animEditor.clip;

    const wrapper = document.createElement('div');
    wrapper.className = 'studio-animation-tab-wrapper';

    // 1. Animation Clip Header Section
    const secClip = document.createElement('div');
    secClip.className = 'studio-section';
    secClip.innerHTML = `
        <div class="section-header">
            <span class="section-title">Animation Clip</span>
            <div style="display:flex; gap:4px;">
                <button class="coord-nudge-btn" id="btn-anim-new">+ New</button>
                <button class="coord-nudge-btn" id="btn-anim-save" style="color:var(--studio-accent); font-weight:700;">💾 Save</button>
                <button class="coord-nudge-btn" id="btn-anim-add-lib">To Library</button>
            </div>
        </div>
        <div style="display:flex; gap:8px; align-items:center; margin-top:8px;">
            <label style="font-size:11px; color:var(--studio-text-muted); width:40px;">Name:</label>
            <input type="text" id="anim-name-input" class="studio-input" value="${clip.name || 'new_animation'}" style="flex:1;">
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; margin-top:8px;">
            <div>
                <label style="font-size:10px; color:var(--studio-text-muted);">Duration (s)</label>
                <input type="number" id="anim-duration-input" class="studio-input" step="0.1" min="0.1" max="10.0" value="${clip.duration || 2.0}">
            </div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:14px;">
                <input type="checkbox" id="anim-loop-checkbox" ${clip.loop ? 'checked' : ''}>
                <label for="anim-loop-checkbox" style="font-size:11px; cursor:pointer;">Loop</label>
            </div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:14px;">
                <input type="checkbox" id="anim-override-ik" ${clip.overrideIK ? 'checked' : ''}>
                <label for="anim-override-ik" style="font-size:11px; cursor:pointer;" title="Override procedural IK arms on keyed bones">Override IK</label>
            </div>
        </div>
    `;
    wrapper.appendChild(secClip);

    // 1b. Saved Animation Library Selector
    const secLibrary = document.createElement('div');
    secLibrary.className = 'studio-section';
    const clipsOptions = (_studio.clipsList || []).map(c => {
        const name = typeof c === 'string' ? c : c.name;
        return `<option value="${name}" ${name === clip.name ? 'selected' : ''}>${name}</option>`;
    }).join('');
    secLibrary.innerHTML = `
        <div class="section-header">
            <span class="section-title">Animation Library</span>
            <button class="coord-nudge-btn" id="btn-refresh-clips" title="Refresh clip list from server">↻ Refresh</button>
        </div>
        <select id="anim-clip-select" class="studio-select" style="width:100%; margin-top:6px;">
            <option value="">(Select saved animation...)</option>
            ${clipsOptions}
        </select>
        <div id="clip-lib-pills" style="display:flex; flex-wrap:wrap; gap:4px; margin-top:8px;"></div>
    `;
    wrapper.appendChild(secLibrary);

    // 2. Procedural Variation Section
    const secVar = document.createElement('div');
    secVar.className = 'studio-section';
    secVar.innerHTML = `
        <div class="section-header">
            <span class="section-title">Procedural Variation</span>
            <button class="coord-nudge-btn" id="btn-var-preview" style="color:#38bdf8;">🎲 Randomize Preview</button>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-top:6px;">
            <div>
                <label style="font-size:10px; color:var(--studio-text-muted);">Side Variation</label>
                <select id="var-side-select" class="studio-select" style="width:100%;">
                    <option value="right" ${clip.variation?.side === 'right' ? 'selected' : ''}>Right</option>
                    <option value="left" ${clip.variation?.side === 'left' ? 'selected' : ''}>Left</option>
                    <option value="either" ${(!clip.variation?.side || clip.variation?.side === 'either') ? 'selected' : ''}>Either (Random)</option>
                    <option value="both" ${clip.variation?.side === 'both' ? 'selected' : ''}>Both</option>
                </select>
            </div>
            <div>
                <label style="font-size:10px; color:var(--studio-text-muted);">Noise (±°)</label>
                <input type="number" id="var-noise-input" class="studio-input" min="0" max="25" step="1" value="${clip.variation?.boneNoiseDeg || 3}">
            </div>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-top:6px;">
            <div>
                <label style="font-size:10px; color:var(--studio-text-muted);">Timing Jitter (%)</label>
                <input type="number" id="var-timing-input" class="studio-input" min="0" max="50" step="1" value="${Math.round((clip.variation?.timingJitter || 0.1) * 100)}">
            </div>
            <div>
                <label style="font-size:10px; color:var(--studio-text-muted);">Amp Jitter (%)</label>
                <input type="number" id="var-amp-input" class="studio-input" min="0" max="50" step="1" value="${Math.round((clip.variation?.ampJitter || 0.1) * 100)}">
            </div>
        </div>
    `;
    wrapper.appendChild(secVar);

    // 3. Outliner Container Section
    const secOutliner = document.createElement('div');
    secOutliner.className = 'studio-section';
    secOutliner.innerHTML = `
        <div class="section-header">
            <span class="section-title">Outliner (Bone Hierarchy)</span>
            <span style="font-size:10px; color:var(--studio-text-muted);" id="outliner-sel-count">Selected: ${_animEditor.selectedBones.size}</span>
        </div>
        <div id="studio-outliner-mount"></div>
    `;
    wrapper.appendChild(secOutliner);

    // 4. Bone Transform Numeric Section
    const secManip = document.createElement('div');
    secManip.className = 'studio-section';
    secManip.innerHTML = `
        <div class="section-header">
            <span class="section-title">Transform: <span style="color:var(--studio-accent);" id="selected-bone-name-display">${_studio.selectedBone || 'None'}</span></span>
            <div style="display:flex; gap:4px;">
                <button class="coord-nudge-btn" id="btn-bone-reset" title="Reset bone rotation (Alt+R)">Reset [Alt+R]</button>
                <button class="coord-nudge-btn" id="btn-bone-mirror" title="Mirror bone rotation to opposite side">Mirror</button>
            </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
            <div style="display:flex; gap:4px; align-items:center;">
                <span style="font-size:10px; color:var(--studio-text-muted);">Space:</span>
                <button class="coord-nudge-btn ${_studio.boneSpace === 'local' ? 'active' : ''}" id="btn-space-local">Local</button>
                <button class="coord-nudge-btn ${_studio.boneSpace === 'world' ? 'active' : ''}" id="btn-space-world">World</button>
            </div>
            <div style="display:flex; gap:3px; align-items:center;">
                <span style="font-size:10px; color:var(--studio-text-muted);">Snap:</span>
                <button class="coord-nudge-btn ${_studio.boneSnap === 0 ? 'active' : ''}" id="btn-snap-off">Off</button>
                <button class="coord-nudge-btn ${_studio.boneSnap === 1 ? 'active' : ''}" id="btn-snap-1">1°</button>
                <button class="coord-nudge-btn ${_studio.boneSnap === 5 ? 'active' : ''}" id="btn-snap-5">5°</button>
                <button class="coord-nudge-btn ${_studio.boneSnap === 15 ? 'active' : ''}" id="btn-snap-15">15°</button>
            </div>
        </div>
        <div class="euler-input-group">
            <div class="euler-field">
                <span class="euler-label">X°</span>
                <input type="number" class="euler-input" id="euler-rot-x" step="1">
            </div>
            <div class="euler-field">
                <span class="euler-label">Y°</span>
                <input type="number" class="euler-input" id="euler-rot-y" step="1">
            </div>
            <div class="euler-field">
                <span class="euler-label">Z°</span>
                <input type="number" class="euler-input" id="euler-rot-z" step="1">
            </div>
        </div>
    `;
    wrapper.appendChild(secManip);

    // 5. Pose Library & Tools Section
    const secPose = document.createElement('div');
    secPose.className = 'studio-section';
    secPose.innerHTML = `
        <div class="section-header">
            <span class="section-title">Pose Tools & Library</span>
            <button class="coord-nudge-btn" id="btn-capture-pose" style="color:var(--studio-accent); font-weight:700;">+ Capture Pose</button>
        </div>
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:4px; margin-top:6px;">
            <button class="coord-nudge-btn" id="btn-copy-pose" title="Copy Pose (Ctrl+C)">Copy [Ctrl+C]</button>
            <button class="coord-nudge-btn" id="btn-paste-pose" title="Paste Pose (Ctrl+V)">Paste [Ctrl+V]</button>
            <button class="coord-nudge-btn" id="btn-paste-flip" title="Paste Flipped (Ctrl+Shift+V)">Flip [Ctrl+⇧+V]</button>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:4px; margin-top:4px;">
            <button class="coord-nudge-btn" id="btn-mirror-pose">Mirror Entire Pose</button>
            <button class="coord-nudge-btn" id="btn-reset-all-pose" style="color:#ff6b6b;">Reset All Bones</button>
        </div>
        <div class="pose-lib-grid" id="pose-library-grid"></div>
    `;
    wrapper.appendChild(secPose);

    // 6. Keyframing Operations Section
    const secKeyOps = document.createElement('div');
    secKeyOps.className = 'studio-section';
    secKeyOps.innerHTML = `
        <div class="section-header">
            <span class="section-title">Keyframe Operations</span>
            <div style="display:flex; gap:4px; align-items:center;">
                <span style="font-size:10px; color:var(--studio-text-muted);">Interp:</span>
                <select id="anim-interp-select" class="studio-select" style="font-size:10px; padding:2px 4px;">
                    <option value="smooth" ${_animEditor.defaultInterp === 'smooth' ? 'selected' : ''}>Smooth</option>
                    <option value="linear" ${_animEditor.defaultInterp === 'linear' ? 'selected' : ''}>Linear</option>
                    <option value="constant" ${_animEditor.defaultInterp === 'constant' ? 'selected' : ''}>Constant</option>
                </select>
            </div>
        </div>
        <div style="display:flex; gap:6px; margin-top:6px;">
            <button class="timeline-quick-btn" id="btn-key-selected" style="flex:1; background:var(--studio-accent); color:#0b0f19; font-weight:700;">Key Selected [I]</button>
            <button class="timeline-quick-btn" id="btn-key-modified" style="flex:1;">Key All Modified</button>
            <button class="timeline-quick-btn" id="btn-bake-bones" style="flex:1;">Bake Bones</button>
            <button class="timeline-quick-btn" id="btn-del-key" style="color:#ff6b6b;" title="Delete key at playhead [Alt+I]">Delete [Alt+I]</button>
        </div>
    `;
    wrapper.appendChild(secKeyOps);

    container.appendChild(wrapper);

    // Bind event listeners for the tab
    _bindAnimationTabEvents(wrapper);

    // Mount Outliner
    const outlinerMount = wrapper.querySelector('#studio-outliner-mount');
    if (outlinerMount) {
        _studioOutliner = new StudioOutliner(outlinerMount, {
            onSelectBone: (boneName, additive) => _selectBoneInStudio(boneName, additive),
            onToggleVisibility: (boneName) => {
                if (_skeletonOverlay) _skeletonOverlay.toggleBoneVisibility(boneName);
            },
            onToggleLock: (boneName) => {
                if (_studioOutliner.isLocked(boneName) && _studio.selectedBone === boneName) {
                    _transformControlsBone?.detach();
                }
            }
        });
        _studioOutliner.setSelection(_animEditor.selectedBones);
        _studioOutliner.setKeyedBones(new Set(Object.keys(_animEditor.clip?.tracks || {})));
    }

    // Mount Dope Sheet in #studio-timeline-container
    const timelineContainer = document.getElementById('studio-timeline-container');
    if (timelineContainer) {
        timelineContainer.innerHTML = '';
        _studioDopeSheet = new StudioDopeSheet(timelineContainer, {
            animEditor: _animEditor,
            onUpdate: () => {
                _updateNumericPanelUI();
                _updateSkeletonKeyedBones();
                _studioOutliner?.setKeyedBones(new Set(Object.keys(_animEditor.clip?.tracks || {})));
            }
        });
    }

    // Populate Pose Library List
    const poseGrid = wrapper.querySelector('#pose-library-grid');
    if (poseGrid) _renderPoseLibraryList(poseGrid);

    _attachBoneGizmo();
    _updateNumericPanelUI();
    _updateSkeletonKeyedBones();
}

function _bindAnimationTabEvents(wrapper) {
    const clip = _animEditor.clip;

    wrapper.querySelector('#anim-name-input')?.addEventListener('change', (e) => {
        clip.name = e.target.value.trim() || 'animation';
    });
    wrapper.querySelector('#anim-duration-input')?.addEventListener('change', (e) => {
        clip.duration = Math.max(0.1, parseFloat(e.target.value) || 2.0);
        _studioDopeSheet?.refresh();
    });
    wrapper.querySelector('#anim-loop-checkbox')?.addEventListener('change', (e) => {
        clip.loop = !!e.target.checked;
    });
    wrapper.querySelector('#anim-override-ik')?.addEventListener('change', (e) => {
        clip.overrideIK = !!e.target.checked;
    });

    wrapper.querySelector('#btn-anim-new')?.addEventListener('click', () => {
        const name = prompt('New animation name:', 'new_animation');
        if (!name) return;
        _animEditor.newClip(name.trim(), 2.0);
        _renderTab('animation');
    });

    wrapper.querySelector('#btn-anim-save')?.addEventListener('click', async () => {
        const ok = await _animEditor.saveClipToDisk();
        if (ok) _showToast(`Animation "${clip.name}" saved!`);
    });

    wrapper.querySelector('#btn-anim-add-lib')?.addEventListener('click', () => {
        _studio.library[clip.name] = {
            type: 'clip',
            clip: clip.name,
            lead: 'dominant',
            holdUntilReleased: !!clip.holdUntilReleased
        };
        _studio.isUnsaved = true;
        _clipLayer?.registerClip(clip.name, clip);
        _showToast(`Added "${clip.name}" to GESTURE_LIBRARY!`);
    });

    // Saved animation library events
    wrapper.querySelector('#anim-clip-select')?.addEventListener('change', (e) => {
        const name = e.target.value;
        if (!name) return;
        const found = (_studio.clipsList || []).find(c => (typeof c === 'string' ? c : c.name) === name);
        if (found) {
            const clipData = typeof found === 'string' ? { name: found, duration: 2.0, tracks: {} } : found;
            _animEditor.loadClip(clipData);
            _renderTab('animation');
        }
    });
    wrapper.querySelector('#btn-refresh-clips')?.addEventListener('click', () => {
        fetch('/__anna/list-clips')
            .then(res => res.json())
            .then(data => {
                if (data.clips) {
                    _studio.clipsList = data.clips;
                    data.clips.forEach(c => _clipLayer?.registerClip(typeof c === 'string' ? c : c.name, c));
                    _renderTab('animation');
                    _showToast('Clips refreshed!');
                }
            })
            .catch(() => _showToast('Failed to fetch clips'));
    });

    // Populate clip pills for quick-select
    const pillsContainer = wrapper.querySelector('#clip-lib-pills');
    if (pillsContainer && _studio.clipsList?.length) {
        _studio.clipsList.forEach(c => {
            const name = typeof c === 'string' ? c : c.name;
            const pill = document.createElement('div');
            pill.className = `gesture-pill ${name === clip.name ? 'active' : ''}`;
            pill.textContent = name;
            pill.style.cssText = 'font-size:10px; padding:3px 8px;';
            pill.addEventListener('click', () => {
                const clipData = typeof c === 'string' ? { name: c, duration: 2.0, tracks: {} } : c;
                _animEditor.loadClip(clipData);
                _renderTab('animation');
            });
            pillsContainer.appendChild(pill);
        });
    }

    // Variation settings
    const ensureVar = () => {
        if (!clip.variation) clip.variation = {};
    };
    wrapper.querySelector('#var-side-select')?.addEventListener('change', (e) => {
        ensureVar();
        clip.variation.side = e.target.value;
    });
    wrapper.querySelector('#var-noise-input')?.addEventListener('change', (e) => {
        ensureVar();
        clip.variation.boneNoiseDeg = parseFloat(e.target.value) || 0;
    });
    wrapper.querySelector('#var-timing-input')?.addEventListener('change', (e) => {
        ensureVar();
        clip.variation.timingJitter = (parseFloat(e.target.value) || 0) / 100;
    });
    wrapper.querySelector('#var-amp-input')?.addEventListener('change', (e) => {
        ensureVar();
        clip.variation.ampJitter = (parseFloat(e.target.value) || 0) / 100;
    });
    wrapper.querySelector('#btn-var-preview')?.addEventListener('click', () => {
        const seed = Math.floor(Math.random() * 999999);
        const varied = applyVariation(clip, { seed });
        if (_clipLayer) {
            _clipLayer.play(varied, { speed: 1.0, loop: false });
        }
        _showToast(`Previewing randomized variation (seed ${seed})`);
    });

    // Numeric Transform events
    wrapper.querySelector('#btn-bone-reset')?.addEventListener('click', () => {
        _animEditor.resetBone(_studio.selectedBone);
        _updateNumericPanelUI();
    });
    wrapper.querySelector('#btn-bone-mirror')?.addEventListener('click', _mirrorSelectedBone);

    wrapper.querySelector('#btn-space-local')?.addEventListener('click', () => {
        _studio.boneSpace = 'local';
        if (_transformControlsBone) _transformControlsBone.space = 'local';
        wrapper.querySelector('#btn-space-local').classList.add('active');
        wrapper.querySelector('#btn-space-world').classList.remove('active');
    });
    wrapper.querySelector('#btn-space-world')?.addEventListener('click', () => {
        _studio.boneSpace = 'world';
        if (_transformControlsBone) _transformControlsBone.space = 'world';
        wrapper.querySelector('#btn-space-world').classList.add('active');
        wrapper.querySelector('#btn-space-local').classList.remove('active');
    });

    const setSnap = (deg) => {
        _studio.boneSnap = deg;
        if (_transformControlsBone) {
            _transformControlsBone.setRotationSnap(deg > 0 ? THREE.MathUtils.degToRad(deg) : null);
        }
        ['off', '1', '5', '15'].forEach(s => {
            const btn = wrapper.querySelector(`#btn-snap-${s}`);
            if (btn) btn.classList.toggle('active', (s === 'off' && deg === 0) || s === String(deg));
        });
    };
    wrapper.querySelector('#btn-snap-off')?.addEventListener('click', () => setSnap(0));
    wrapper.querySelector('#btn-snap-1')?.addEventListener('click', () => setSnap(1));
    wrapper.querySelector('#btn-snap-5')?.addEventListener('click', () => setSnap(5));
    wrapper.querySelector('#btn-snap-15')?.addEventListener('click', () => setSnap(15));

    const onEulerChange = () => {
        const x = parseFloat(wrapper.querySelector('#euler-rot-x').value) || 0;
        const y = parseFloat(wrapper.querySelector('#euler-rot-y').value) || 0;
        const z = parseFloat(wrapper.querySelector('#euler-rot-z').value) || 0;
        _animEditor.setBoneEulerDeg(_studio.selectedBone, x, y, z);
        _updateSkeletonKeyedBones();
        _studioDopeSheet?.refresh();
    };
    wrapper.querySelector('#euler-rot-x')?.addEventListener('change', onEulerChange);
    wrapper.querySelector('#euler-rot-y')?.addEventListener('change', onEulerChange);
    wrapper.querySelector('#euler-rot-z')?.addEventListener('change', onEulerChange);
    wrapper.querySelector('#euler-rot-x')?.addEventListener('input', onEulerChange);
    wrapper.querySelector('#euler-rot-y')?.addEventListener('input', onEulerChange);
    wrapper.querySelector('#euler-rot-z')?.addEventListener('input', onEulerChange);

    // Pose Tools events
    wrapper.querySelector('#btn-copy-pose')?.addEventListener('click', () => {
        _animEditor.copyPose();
        _showToast('Pose copied to clipboard!');
    });
    wrapper.querySelector('#btn-paste-pose')?.addEventListener('click', () => {
        _animEditor.pastePose();
        _updateNumericPanelUI();
        _updateSkeletonKeyedBones();
        _studioDopeSheet?.refresh();
        _showToast('Pose pasted!');
    });
    wrapper.querySelector('#btn-paste-flip')?.addEventListener('click', () => {
        _animEditor.pasteFlipped();
        _updateNumericPanelUI();
        _updateSkeletonKeyedBones();
        _studioDopeSheet?.refresh();
        _showToast('Flipped pose pasted!');
    });
    wrapper.querySelector('#btn-mirror-pose')?.addEventListener('click', () => {
        _animEditor.mirrorActivePose();
        _updateNumericPanelUI();
        _updateSkeletonKeyedBones();
        _studioDopeSheet?.refresh();
    });
    wrapper.querySelector('#btn-reset-all-pose')?.addEventListener('click', () => {
        if (_vrm?.humanoid) {
            resetAllBones(_vrm.humanoid);
            if (_animEditor.autoKey) _animEditor.insertKeyframe(ALL_HUMANOID_BONES);
            _updateNumericPanelUI();
            _updateSkeletonKeyedBones();
            _studioDopeSheet?.refresh();
        }
    });
    wrapper.querySelector('#btn-capture-pose')?.addEventListener('click', () => {
        const name = prompt('Name for captured pose:');
        if (!name || !_vrm?.humanoid) return;
        const pose = capturePose(_vrm.humanoid, ALL_HUMANOID_BONES);
        savePoseToLibrary(name.trim(), pose);
        const poseGrid = wrapper.querySelector('#pose-library-grid');
        if (poseGrid) _renderPoseLibraryList(poseGrid);
        _showToast(`Pose "${name.trim()}" saved!`);
    });

    // Keyframing operations
    wrapper.querySelector('#anim-interp-select')?.addEventListener('change', (e) => {
        _animEditor.defaultInterp = e.target.value;
    });
    wrapper.querySelector('#btn-key-selected')?.addEventListener('click', () => {
        _animEditor.insertKeyframe();
        _updateSkeletonKeyedBones();
        _studioDopeSheet?.refresh();
        _studioOutliner?.setKeyedBones(new Set(Object.keys(_animEditor.clip?.tracks || {})));
    });
    wrapper.querySelector('#btn-key-modified')?.addEventListener('click', () => {
        _animEditor.keyModified();
        _updateSkeletonKeyedBones();
        _studioDopeSheet?.refresh();
        _studioOutliner?.setKeyedBones(new Set(Object.keys(_animEditor.clip?.tracks || {})));
    });
    wrapper.querySelector('#btn-bake-bones')?.addEventListener('click', () => {
        _animEditor.bakeSelectedBones();
        _updateSkeletonKeyedBones();
        _studioDopeSheet?.refresh();
        _studioOutliner?.setKeyedBones(new Set(Object.keys(_animEditor.clip?.tracks || {})));
    });
    wrapper.querySelector('#btn-del-key')?.addEventListener('click', () => {
        _animEditor.deleteKeyframe();
        _updateSkeletonKeyedBones();
        _studioDopeSheet?.refresh();
        _studioOutliner?.setKeyedBones(new Set(Object.keys(_animEditor.clip?.tracks || {})));
    });
}

function _restoreGestureTimelineIfNeeded() {
    const timelineContainer = document.getElementById('studio-timeline-container');
    if (!timelineContainer || timelineContainer.querySelector('.studio-transport-row')) return;
    timelineContainer.innerHTML = `
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
    `;
    _timelineTrackEl = document.getElementById('studio-timeline-track');
    _timelinePlayheadEl = document.getElementById('studio-playhead');
    _timeDisplayEl = document.getElementById('studio-time-display');
    _setupTimelineEvents();
}

function _renderGesturesTab(container) {
    _restoreGestureTimelineIfNeeded();

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

    const prog = _studio.library[_studio.selectedGesture];
    if (!prog) return;

    // If this is a clip-type gesture, load the clip into the bone editor
    // so users can edit it with the full Blender controls
    if (prog.type === 'clip') {
        const clipName = prog.clip || _studio.selectedGesture;
        const clipData = _clipLayer?.getClip(clipName) || { name: clipName, duration: 2.0, tracks: {} };
        if (_animEditor && (!_animEditor.clip || _animEditor.clip.name !== clipName)) {
            _animEditor.loadClip(clipData);
        }
        // Show an info banner (non-blocking)
        const clipBanner = document.createElement('div');
        clipBanner.className = 'studio-section';
        clipBanner.style.cssText = 'font-size:11px; padding:8px 12px; background:rgba(0,200,255,0.08); border:1px solid rgba(0,200,255,0.2); border-radius:6px; color:var(--studio-text-muted); display:flex; align-items:center; gap:8px;';
        clipBanner.innerHTML = `<span style="font-size:16px;">🎬</span> Editing clip animation: <strong style="color:var(--studio-accent);">${clipName}</strong>`;
        container.appendChild(clipBanner);
    }

    // 2. Keyframes Section
    const activeSide = _getActiveEditSide();
    const hasSideOverride = !!(prog.overrides && prog.overrides[activeSide] && prog.overrides[activeSide].keys);
    const keysToRender = ((!_studio.linkHands && hasSideOverride) ? prog.overrides[activeSide].keys : prog.keys) || [];

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

        const curKeyDur = (key.t !== undefined)
            ? (Array.isArray(key.t) ? ((key.t[0] + key.t[1]) / 2) : key.t)
            : (kIdx === 0 ? 0.3 : 0.22);

        card.innerHTML = `
            <div class="keyframe-card-header">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span>Keyframe ${kIdx}</span>
                    <span class="key-dur-display" style="color:#00ffff; font-family:monospace; font-size:11px; font-weight:700; background:rgba(0,255,255,0.12); padding:1px 6px; border-radius:3px; border:1px solid rgba(0,255,255,0.3);">${curKeyDur.toFixed(2)}s</span>
                </div>
                <span style="font-size:10px; color:var(--studio-text-muted);">${kIdx === 0 ? 'Prep Duration' : `Stroke #${kIdx} Duration`}</span>
            </div>

            <!-- Duration Controls: Time to transition to this keyframe -->
            <div class="coord-control-row key-dur-row" style="background:rgba(0, 210, 255, 0.05); padding:4px 6px; border-radius:4px; margin-bottom:8px; border:1px solid rgba(0, 210, 255, 0.18);">
                <span class="coord-label" style="color:#38bdf8; font-weight:600; width:72px;" title="Duration to transition from previous keyframe to this keyframe">⏱️ Time (s)</span>
                <input type="range" class="coord-slider key-dur-slider" min="0.05" max="3.0" step="0.01" value="${curKeyDur}">
                <input type="number" class="coord-num-input key-dur-num" step="0.01" min="0.05" max="10.0" value="${curKeyDur}">
                <div class="coord-nudge-group">
                    <button class="coord-nudge-btn key-dur-nudge" data-delta="-0.1">-0.1</button>
                    <button class="coord-nudge-btn key-dur-nudge" data-delta="-0.05">-0.05</button>
                    <button class="coord-nudge-btn key-dur-nudge" data-delta="0.05">+0.05</button>
                    <button class="coord-nudge-btn key-dur-nudge" data-delta="0.1">+0.1</button>
                </div>
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

        // Wire Duration controls
        const durSlider = card.querySelector('.key-dur-slider');
        const durNum = card.querySelector('.key-dur-num');
        const durRow = card.querySelector('.key-dur-row');

        const updateKeyDuration = (newDur, pushHistory = true) => {
            const clamped = Math.max(0.05, Math.min(10.0, Math.round(newDur * 100) / 100));
            _mutateKey(prog, kIdx, (k) => { k.t = [clamped, clamped]; });
            _markUnsaved();
            _rebuildPlayer();
            _syncKeyframeTimingInputs(kIdx, clamped);
            if (pushHistory) {
                _history.push(_studio.library, `Set Key ${kIdx} duration to ${clamped}s`);
            }
        };

        durSlider?.addEventListener('input', (e) => {
            updateKeyDuration(parseFloat(e.target.value), false);
        });
        durSlider?.addEventListener('change', (e) => {
            updateKeyDuration(parseFloat(e.target.value), true);
        });

        durNum?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) updateKeyDuration(val, false);
        });
        durNum?.addEventListener('change', (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) updateKeyDuration(val, true);
        });

        card.querySelectorAll('.key-dur-nudge').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const delta = parseFloat(btn.dataset.delta);
                const curVal = parseFloat(durSlider?.value || 0.3);
                updateKeyDuration(curVal + delta, true);
            });
        });

        durRow?.addEventListener('wheel', (e) => {
            e.preventDefault();
            const step = e.shiftKey ? 0.05 : 0.01;
            const dir = e.deltaY < 0 ? 1 : -1;
            const curVal = parseFloat(durSlider?.value || 0.3);
            updateKeyDuration(curVal + dir * step, false);
        }, { passive: false });

        // Wire coordinate inputs
        card.querySelectorAll('.coord-slider, .coord-num-input').forEach(input => {
            if (input.classList.contains('key-dur-slider') || input.classList.contains('key-dur-num')) return;
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
            if (row.classList.contains('key-dur-row')) return;
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
            if (btn.classList.contains('key-dur-nudge')) return;
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
    const curHoldDur = (prog.hold !== undefined)
        ? (Array.isArray(prog.hold) ? (prog.hold[0] + prog.hold[1]) / 2 : prog.hold)
        : 0.35;
    const curRetractDur = (prog.retract !== undefined)
        ? (Array.isArray(prog.retract) ? (prog.retract[0] + prog.retract[1]) / 2 : prog.retract)
        : 0.38;

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

        <!-- Timing Settings: Hold & Retract -->
        <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px; background:rgba(255,255,255,0.02); padding:8px; border-radius:4px; border:1px solid var(--studio-border);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:11px; font-weight:700; color:#e2e8f0;">Timing & Transition</span>
                <span style="font-size:10px; color:var(--studio-text-muted);">Adjust hold & return speeds</span>
            </div>

            <!-- Hold Duration -->
            <div class="coord-control-row" style="margin-bottom:0;">
                <span class="coord-label" style="width:85px;" title="Duration to hold pose before releasing">⏸️ Hold (s)</span>
                <input type="range" class="coord-slider" id="setting-hold-slider" min="0.0" max="4.0" step="0.05" value="${curHoldDur}">
                <input type="number" class="coord-num-input" id="setting-hold-num" min="0.0" max="10.0" step="0.05" value="${curHoldDur}">
                <div class="coord-nudge-group">
                    <button class="coord-nudge-btn nudge-hold" data-delta="-0.1">-0.1</button>
                    <button class="coord-nudge-btn nudge-hold" data-delta="0.1">+0.1</button>
                </div>
            </div>

            <!-- Retract Duration -->
            <div class="coord-control-row" style="margin-bottom:0;">
                <span class="coord-label" style="width:85px;" title="Duration to smoothly return back to idle resting pose">↩️ Retract (s)</span>
                <input type="range" class="coord-slider" id="setting-retract-slider" min="0.05" max="3.0" step="0.05" value="${curRetractDur}">
                <input type="number" class="coord-num-input" id="setting-retract-num" min="0.05" max="10.0" step="0.05" value="${curRetractDur}">
                <div class="coord-nudge-group">
                    <button class="coord-nudge-btn nudge-retract" data-delta="-0.1">-0.1</button>
                    <button class="coord-nudge-btn nudge-retract" data-delta="0.1">+0.1</button>
                </div>
            </div>
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

    // Wire Hold Duration
    const holdSlider = secSettings.querySelector('#setting-hold-slider');
    const holdNum = secSettings.querySelector('#setting-hold-num');
    const updateHold = (val, pushHist = true) => {
        const clamped = Math.max(0.0, Math.min(10.0, Math.round(val * 100) / 100));
        prog.hold = [clamped, clamped];
        if (holdSlider) holdSlider.value = clamped;
        if (holdNum && document.activeElement !== holdNum) holdNum.value = clamped;
        _markUnsaved();
        _rebuildPlayer();
        _syncKeyframeTimingInputs(undefined, undefined);
        if (pushHist) _history.push(_studio.library, `Change hold to ${clamped}s`);
    };
    holdSlider?.addEventListener('input', (e) => updateHold(parseFloat(e.target.value), false));
    holdSlider?.addEventListener('change', (e) => updateHold(parseFloat(e.target.value), true));
    holdNum?.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) updateHold(v, false);
    });
    holdNum?.addEventListener('change', (e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) updateHold(v, true);
    });
    secSettings.querySelectorAll('.nudge-hold').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = parseFloat(btn.dataset.delta);
            const curVal = parseFloat(holdSlider?.value || 0.35);
            updateHold(curVal + delta, true);
        });
    });

    // Wire Retract Duration
    const retractSlider = secSettings.querySelector('#setting-retract-slider');
    const retractNum = secSettings.querySelector('#setting-retract-num');
    const updateRetract = (val, pushHist = true) => {
        const clamped = Math.max(0.05, Math.min(10.0, Math.round(val * 100) / 100));
        prog.retract = [clamped, clamped];
        if (retractSlider) retractSlider.value = clamped;
        if (retractNum && document.activeElement !== retractNum) retractNum.value = clamped;
        _markUnsaved();
        _rebuildPlayer();
        _syncKeyframeTimingInputs(undefined, undefined);
        if (pushHist) _history.push(_studio.library, `Change retract to ${clamped}s`);
    };
    retractSlider?.addEventListener('input', (e) => updateRetract(parseFloat(e.target.value), false));
    retractSlider?.addEventListener('change', (e) => updateRetract(parseFloat(e.target.value), true));
    retractNum?.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) updateRetract(v, false);
    });
    retractNum?.addEventListener('change', (e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) updateRetract(v, true);
    });
    secSettings.querySelectorAll('.nudge-retract').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = parseFloat(btn.dataset.delta);
            const curVal = parseFloat(retractSlider?.value || 0.38);
            updateRetract(curVal + delta, true);
        });
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

    // ═══ BLENDER BONE CONTROLS (Unified from Animation tab) ═══
    if (_animEditor) {
        // Divider
        const divBlender = document.createElement('div');
        divBlender.style.cssText = 'border-top:1px solid rgba(255,255,255,0.06); margin:12px 0; padding-top:8px;';
        divBlender.innerHTML = '<div style="font-size:10px; text-transform:uppercase; letter-spacing:1.5px; color:var(--studio-text-muted); margin-bottom:8px;">🦴 Bone Editor & Animation Clip</div>';
        container.appendChild(divBlender);

        // Animation Clip Header
        const clip = _animEditor.clip;
        const secClipUnified = document.createElement('div');
        secClipUnified.className = 'studio-section';
        secClipUnified.innerHTML = `
            <div class="section-header">
                <span class="section-title">Animation Clip</span>
                <div style="display:flex; gap:4px;">
                    <button class="coord-nudge-btn" id="btn-anim-new">+ New</button>
                    <button class="coord-nudge-btn" id="btn-anim-save" style="color:var(--studio-accent); font-weight:700;">💾 Save</button>
                    <button class="coord-nudge-btn" id="btn-anim-add-lib">To Library</button>
                </div>
            </div>
            <div style="display:flex; gap:8px; align-items:center; margin-top:8px;">
                <label style="font-size:11px; color:var(--studio-text-muted); width:40px;">Name:</label>
                <input type="text" id="anim-name-input" class="studio-input" value="${clip.name || 'new_animation'}" style="flex:1;">
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; margin-top:8px;">
                <div>
                    <label style="font-size:10px; color:var(--studio-text-muted);">Duration (s)</label>
                    <input type="number" id="anim-duration-input" class="studio-input" step="0.1" min="0.1" max="10.0" value="${clip.duration || 2.0}">
                </div>
                <div style="display:flex; align-items:center; gap:6px; margin-top:14px;">
                    <input type="checkbox" id="anim-loop-checkbox" ${clip.loop ? 'checked' : ''}>
                    <label for="anim-loop-checkbox" style="font-size:11px; cursor:pointer;">Loop</label>
                </div>
                <div style="display:flex; align-items:center; gap:6px; margin-top:14px;">
                    <input type="checkbox" id="anim-override-ik" ${clip.overrideIK ? 'checked' : ''}>
                    <label for="anim-override-ik" style="font-size:11px; cursor:pointer;" title="Override procedural IK arms on keyed bones">Override IK</label>
                </div>
            </div>
        `;
        container.appendChild(secClipUnified);

        // Animation Library Selector
        const secLibUnified = document.createElement('div');
        secLibUnified.className = 'studio-section';
        const clipsOptions = (_studio.clipsList || []).map(c => {
            const name = typeof c === 'string' ? c : c.name;
            return `<option value="${name}" ${name === clip.name ? 'selected' : ''}>${name}</option>`;
        }).join('');
        secLibUnified.innerHTML = `
            <div class="section-header">
                <span class="section-title">Animation Library</span>
                <button class="coord-nudge-btn" id="btn-refresh-clips" title="Refresh clip list from server">↻ Refresh</button>
            </div>
            <select id="anim-clip-select" class="studio-select" style="width:100%; margin-top:6px;">
                <option value="">(Select saved animation...)</option>
                ${clipsOptions}
            </select>
            <div id="clip-lib-pills" style="display:flex; flex-wrap:wrap; gap:4px; margin-top:8px;"></div>
        `;
        container.appendChild(secLibUnified);

        // Outliner
        const secOutlinerUnified = document.createElement('div');
        secOutlinerUnified.className = 'studio-section';
        secOutlinerUnified.innerHTML = `
            <div class="section-header">
                <span class="section-title">Outliner (Bone Hierarchy)</span>
                <span style="font-size:10px; color:var(--studio-text-muted);" id="outliner-sel-count">Selected: ${_animEditor.selectedBones.size}</span>
            </div>
            <div id="studio-outliner-mount"></div>
        `;
        container.appendChild(secOutlinerUnified);

        // Bone Transform Numeric
        const secManipUnified = document.createElement('div');
        secManipUnified.className = 'studio-section';
        secManipUnified.innerHTML = `
            <div class="section-header">
                <span class="section-title">Transform: <span style="color:var(--studio-accent);" id="selected-bone-name-display">${_studio.selectedBone || 'None'}</span></span>
                <div style="display:flex; gap:4px;">
                    <button class="coord-nudge-btn" id="btn-bone-reset" title="Reset bone rotation (Alt+R)">Reset [Alt+R]</button>
                    <button class="coord-nudge-btn" id="btn-bone-mirror" title="Mirror bone rotation to opposite side">Mirror</button>
                </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
                <div style="display:flex; gap:4px; align-items:center;">
                    <span style="font-size:10px; color:var(--studio-text-muted);">Space:</span>
                    <button class="coord-nudge-btn ${_studio.boneSpace === 'local' ? 'active' : ''}" id="btn-space-local">Local</button>
                    <button class="coord-nudge-btn ${_studio.boneSpace === 'world' ? 'active' : ''}" id="btn-space-world">World</button>
                </div>
                <div style="display:flex; gap:3px; align-items:center;">
                    <span style="font-size:10px; color:var(--studio-text-muted);">Snap:</span>
                    <button class="coord-nudge-btn ${_studio.boneSnap === 0 ? 'active' : ''}" id="btn-snap-off">Off</button>
                    <button class="coord-nudge-btn ${_studio.boneSnap === 1 ? 'active' : ''}" id="btn-snap-1">1°</button>
                    <button class="coord-nudge-btn ${_studio.boneSnap === 5 ? 'active' : ''}" id="btn-snap-5">5°</button>
                    <button class="coord-nudge-btn ${_studio.boneSnap === 15 ? 'active' : ''}" id="btn-snap-15">15°</button>
                </div>
            </div>
            <div class="euler-input-group">
                <div class="euler-field">
                    <span class="euler-label">X°</span>
                    <input type="number" class="euler-input" id="euler-rot-x" step="1">
                </div>
                <div class="euler-field">
                    <span class="euler-label">Y°</span>
                    <input type="number" class="euler-input" id="euler-rot-y" step="1">
                </div>
                <div class="euler-field">
                    <span class="euler-label">Z°</span>
                    <input type="number" class="euler-input" id="euler-rot-z" step="1">
                </div>
            </div>
        `;
        container.appendChild(secManipUnified);

        // Pose Tools & Library
        const secPoseUnified = document.createElement('div');
        secPoseUnified.className = 'studio-section';
        secPoseUnified.innerHTML = `
            <div class="section-header">
                <span class="section-title">Pose Tools & Library</span>
                <button class="coord-nudge-btn" id="btn-capture-pose" style="color:var(--studio-accent); font-weight:700;">+ Capture Pose</button>
            </div>
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:4px; margin-top:6px;">
                <button class="coord-nudge-btn" id="btn-copy-pose" title="Copy Pose (Ctrl+C)">Copy [Ctrl+C]</button>
                <button class="coord-nudge-btn" id="btn-paste-pose" title="Paste Pose (Ctrl+V)">Paste [Ctrl+V]</button>
                <button class="coord-nudge-btn" id="btn-paste-flip" title="Paste Flipped (Ctrl+Shift+V)">Flip [Ctrl+⇧+V]</button>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:4px; margin-top:4px;">
                <button class="coord-nudge-btn" id="btn-mirror-pose">Mirror Entire Pose</button>
                <button class="coord-nudge-btn" id="btn-reset-all-pose" style="color:#ff6b6b;">Reset All Bones</button>
            </div>
            <div class="pose-lib-grid" id="pose-library-grid"></div>
        `;
        container.appendChild(secPoseUnified);

        // Keyframe Operations
        const secKeyOpsUnified = document.createElement('div');
        secKeyOpsUnified.className = 'studio-section';
        secKeyOpsUnified.innerHTML = `
            <div class="section-header">
                <span class="section-title">Keyframe Operations</span>
                <div style="display:flex; gap:4px; align-items:center;">
                    <span style="font-size:10px; color:var(--studio-text-muted);">Interp:</span>
                    <select id="anim-interp-select" class="studio-select" style="font-size:10px; padding:2px 4px;">
                        <option value="smooth" ${_animEditor.defaultInterp === 'smooth' ? 'selected' : ''}>Smooth</option>
                        <option value="linear" ${_animEditor.defaultInterp === 'linear' ? 'selected' : ''}>Linear</option>
                        <option value="constant" ${_animEditor.defaultInterp === 'constant' ? 'selected' : ''}>Constant</option>
                    </select>
                </div>
            </div>
            <div style="display:flex; gap:6px; margin-top:6px;">
                <button class="timeline-quick-btn" id="btn-key-selected" style="flex:1; background:var(--studio-accent); color:#0b0f19; font-weight:700;">Key Selected [I]</button>
                <button class="timeline-quick-btn" id="btn-key-modified" style="flex:1;">Key All Modified</button>
                <button class="timeline-quick-btn" id="btn-bake-bones" style="flex:1;">Bake Bones</button>
                <button class="timeline-quick-btn" id="btn-del-key" style="color:#ff6b6b;" title="Delete key at playhead [Alt+I]">Delete [Alt+I]</button>
            </div>
        `;
        container.appendChild(secKeyOpsUnified);

        // Bind all Blender bone events
        _bindAnimationTabEvents(container);

        // Mount Outliner
        const outlinerMount = container.querySelector('#studio-outliner-mount');
        if (outlinerMount) {
            _studioOutliner = new StudioOutliner(outlinerMount, {
                onSelectBone: (boneName, additive) => _selectBoneInStudio(boneName, additive),
                onToggleVisibility: (boneName) => {
                    if (_skeletonOverlay) _skeletonOverlay.toggleBoneVisibility(boneName);
                },
                onToggleLock: (boneName) => {
                    if (_studioOutliner.isLocked(boneName) && _studio.selectedBone === boneName) {
                        _transformControlsBone?.detach();
                    }
                }
            });
            _studioOutliner.setSelection(_animEditor.selectedBones);
            _studioOutliner.setKeyedBones(new Set(Object.keys(_animEditor.clip?.tracks || {})));
        }

        // Mount Dope Sheet in #studio-timeline-container
        const timelineContainer = document.getElementById('studio-timeline-container');
        if (timelineContainer) {
            timelineContainer.innerHTML = '';
            _studioDopeSheet = new StudioDopeSheet(timelineContainer, {
                animEditor: _animEditor,
                onUpdate: () => {
                    _updateNumericPanelUI();
                    _updateSkeletonKeyedBones();
                    _studioOutliner?.setKeyedBones(new Set(Object.keys(_animEditor.clip?.tracks || {})));
                }
            });
        }

        // Populate Pose Library List
        const poseGrid = container.querySelector('#pose-library-grid');
        if (poseGrid) _renderPoseLibraryList(poseGrid);

        _attachBoneGizmo();
        _updateNumericPanelUI();
        _updateSkeletonKeyedBones();
    }

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
        if (input.classList.contains('key-dur-slider') || input.classList.contains('key-dur-num')) return;
        const axis = parseInt(input.dataset.axis);
        if (!isNaN(axis) && key.pos) input.value = key.pos[axis];
    });

    const curDur = (key.t !== undefined)
        ? (Array.isArray(key.t) ? ((key.t[0] + key.t[1]) / 2) : key.t)
        : 0.3;
    _syncKeyframeTimingInputs(_studio.selectedKeyIndex, curDur);

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
        <div class="studio-modal" style="max-width:520px; max-height:80vh; overflow-y:auto;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <span style="font-weight:700; font-size:14px;">⌨ Keyboard Shortcuts</span>
                <button class="coord-nudge-btn" id="btn-close-modal">✕</button>
            </div>

            <div style="font-size:11px; font-weight:700; color:var(--studio-accent); margin:10px 0 6px; text-transform:uppercase; letter-spacing:1px;">
                Animation Tab
            </div>
            <div class="shortcut-row"><span>Insert Keyframe (selected bones)</span><span class="shortcut-key">I</span></div>
            <div class="shortcut-row"><span>Delete Keyframe at Playhead</span><span class="shortcut-key">Alt + I</span></div>
            <div class="shortcut-row"><span>Play / Pause</span><span class="shortcut-key">Space</span></div>
            <div class="shortcut-row"><span>Prev / Next Keyframe</span><span class="shortcut-key">[ / ]</span></div>
            <div class="shortcut-row"><span>Step Frame</span><span class="shortcut-key">← / →</span></div>
            <div class="shortcut-row"><span>Rotate mode (gizmo)</span><span class="shortcut-key">R</span></div>
            <div class="shortcut-row"><span>Move mode (gizmo)</span><span class="shortcut-key">G</span></div>
            <div class="shortcut-row"><span>Axis constraint</span><span class="shortcut-key">X / Y / Z (after R or G)</span></div>
            <div class="shortcut-row"><span>Reset selected bone(s)</span><span class="shortcut-key">Alt + R</span></div>
            <div class="shortcut-row"><span>Frame selected bone</span><span class="shortcut-key">F</span></div>
            <div class="shortcut-row"><span>Select all bones</span><span class="shortcut-key">A</span></div>
            <div class="shortcut-row"><span>Deselect all bones</span><span class="shortcut-key">Alt + A</span></div>
            <div class="shortcut-row"><span>Copy Pose</span><span class="shortcut-key">Ctrl + C</span></div>
            <div class="shortcut-row"><span>Paste Pose</span><span class="shortcut-key">Ctrl + V</span></div>
            <div class="shortcut-row"><span>Paste Pose Flipped</span><span class="shortcut-key">Ctrl + Shift + V</span></div>
            <div class="shortcut-row"><span>Save Animation</span><span class="shortcut-key">Ctrl + S</span></div>
            <div class="shortcut-row"><span>Cycle Shading (Solid/Wire/XRay)</span><span class="shortcut-key">Z</span></div>

            <div style="font-size:11px; font-weight:700; color:#38bdf8; margin:14px 0 6px; text-transform:uppercase; letter-spacing:1px;">
                IK Gestures Tab
            </div>
            <div class="shortcut-row"><span>Play / Pause Gesture</span><span class="shortcut-key">Space</span></div>
            <div class="shortcut-row"><span>Step Frame</span><span class="shortcut-key">← / →</span></div>
            <div class="shortcut-row"><span>Prev / Next Keyframe</span><span class="shortcut-key">[ / ]</span></div>
            <div class="shortcut-row"><span>Toggle Loop</span><span class="shortcut-key">L</span></div>
            <div class="shortcut-row"><span>Reset Engine to Idle</span><span class="shortcut-key">R</span></div>
            <div class="shortcut-row"><span>Fire from Start</span><span class="shortcut-key">F</span></div>
            <div class="shortcut-row"><span>Quick Load Gesture</span><span class="shortcut-key">1 – 9</span></div>

            <div style="font-size:11px; font-weight:700; color:#a78bfa; margin:14px 0 6px; text-transform:uppercase; letter-spacing:1px;">
                Global
            </div>
            <div class="shortcut-row"><span>Undo / Redo</span><span class="shortcut-key">Ctrl+Z / Ctrl+Shift+Z</span></div>
            <div class="shortcut-row"><span>Save to Project</span><span class="shortcut-key">Ctrl + S</span></div>
            <div class="shortcut-row"><span>Cycle Shading</span><span class="shortcut-key">Z</span></div>
            <div class="shortcut-row"><span>Show this Help</span><span class="shortcut-key">?</span></div>
            <div class="shortcut-row"><span>Compact Toolbar (non-studio)</span><span class="shortcut-key">F2</span></div>
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

    const isAnimation = _studio.activeTab === 'animation';
    const isGestures  = _studio.activeTab === 'gestures';
    const isStudioEdit = isAnimation || isGestures;

    // ── Ctrl / Meta combos ──────────────────────────────────────────────────
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 's' || e.key === 'S') {
            e.preventDefault();
            if (isStudioEdit && _animEditor) {
                _animEditor.saveClipToDisk().then(ok => { if (ok) _showToast('Animation saved!'); });
            }
            _saveToProject();
            return;
        }
        if (e.key === 'z' || e.key === 'Z') {
            e.preventDefault();
            if (e.shiftKey) _redo(); else _undo();
            return;
        }
        // Ctrl+C  – copy pose
        if ((e.key === 'c' || e.key === 'C') && isStudioEdit && _animEditor) {
            e.preventDefault();
            _animEditor.copyPose();
            _showToast('Pose copied!');
            return;
        }
        // Ctrl+V  – paste pose
        if ((e.key === 'v' || e.key === 'V') && isStudioEdit && _animEditor) {
            e.preventDefault();
            if (e.shiftKey) {
                _animEditor.pasteFlipped();
                _showToast('Flipped pose pasted!');
            } else {
                _animEditor.pastePose();
                _showToast('Pose pasted!');
            }
            _updateNumericPanelUI();
            _updateSkeletonKeyedBones();
            _studioDopeSheet?.refresh();
            return;
        }
        return;
    }

    // ── Non-ctrl hotkeys ────────────────────────────────────────────────────

    // ? — shortcuts help
    if (e.key === '?') { _showShortcutsHelp(); return; }

    // F2 — toggle compact toolbar (non-studio)
    if (e.key === 'F2') { e.preventDefault(); if (!_isStudioMode) _toggleCompactToolbar(); return; }

    // ── Studio Blender hotkeys ──────────────────────────────────────────────
    if (isStudioEdit && _animEditor) {
        // I — insert keyframe on selected bones
        if ((e.key === 'i' || e.key === 'I') && !e.altKey) {
            e.preventDefault();
            _animEditor.insertKeyframe();
            _updateSkeletonKeyedBones();
            _studioDopeSheet?.refresh();
            _studioOutliner?.setKeyedBones(new Set(Object.keys(_animEditor.clip?.tracks || {})));
            _showToast('Keyframe inserted');
            return;
        }
        // Alt+I — delete keyframe
        if ((e.key === 'i' || e.key === 'I') && e.altKey) {
            e.preventDefault();
            _animEditor.deleteKeyframe();
            _updateSkeletonKeyedBones();
            _studioDopeSheet?.refresh();
            _studioOutliner?.setKeyedBones(new Set(Object.keys(_animEditor.clip?.tracks || {})));
            return;
        }
        // Space — play / pause
        if (e.code === 'Space') {
            e.preventDefault();
            _animEditor.isPlaying ? _animEditor.pause() : _animEditor.play();
            return;
        }
        // [ ] — prev / next keyframe
        if (e.key === '[') { e.preventDefault(); _animEditor.prevKeyframe(); return; }
        if (e.key === ']') { e.preventDefault(); _animEditor.nextKeyframe(); return; }
        // R — rotate mode
        if (e.key === 'r' || e.key === 'R') {
            if (!e.altKey) {
                e.preventDefault();
                _studio.boneGizmoMode = 'rotate';
                if (_transformControlsBone) _transformControlsBone.setMode('rotate');
                return;
            }
            // Alt+R — reset selected bone(s)
            if (e.altKey) {
                e.preventDefault();
                if (_animEditor.selectedBones.size > 0) {
                    for (const b of _animEditor.selectedBones) _animEditor.resetBone(b);
                } else if (_studio.selectedBone) {
                    _animEditor.resetBone(_studio.selectedBone);
                }
                _updateNumericPanelUI();
                return;
            }
        }
        // G — move / translate mode
        if ((e.key === 'g' || e.key === 'G') && !e.altKey) {
            e.preventDefault();
            _studio.boneGizmoMode = 'translate';
            if (_transformControlsBone) _transformControlsBone.setMode('translate');
            return;
        }
        // X / Y / Z — axis lock
        if (e.key === 'x' || e.key === 'X') { e.preventDefault(); _toggleGizmoAxis('X'); return; }
        if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); _toggleGizmoAxis('Y'); return; }
        if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); _cycleShadingMode(); return; }  // Z = shading cycle
        // F — frame selected bone
        if (e.key === 'f' || e.key === 'F') { e.preventDefault(); _frameSelectedBone(); return; }
        // A — select all bones
        if ((e.key === 'a' || e.key === 'A') && !e.altKey) {
            e.preventDefault();
            import('./studio_viewport.js').then(({ ALL_HUMANOID_BONES }) => {
                const allSet = new Set(ALL_HUMANOID_BONES);
                _animEditor.setSelectedBones(allSet);
                _skeletonOverlay?.setSelectedBones(allSet);
                _studioOutliner?.setSelection(allSet);
            });
            return;
        }
        // Alt+A — deselect all
        if ((e.key === 'a' || e.key === 'A') && e.altKey) {
            e.preventDefault();
            _selectBoneInStudio(null);
            return;
        }
        // ArrowLeft / ArrowRight — step frame
        if (e.key === 'ArrowLeft') { e.preventDefault(); _animEditor.prevKeyframe(); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); _animEditor.nextKeyframe(); return; }
        return; // Don't fall through to gesture controls while on animation tab
    }

    // ── Gestures / IK timeline hotkeys ─────────────────────────────────────
    if (e.code === 'Space') {
        e.preventDefault();
        if (_studio.gestureSubMode === 'clips') {
            _studio.clipIsPlaying = !_studio.clipIsPlaying;
        } else {
            _togglePlayPause();
        }
        return;
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); _stepFrame(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); _stepFrame(1); return; }
    if (e.key === '[') { _jumpKeyframe(-1); return; }
    if (e.key === ']') { _jumpKeyframe(1); return; }
    if (e.key === 'l' || e.key === 'L') { _toggleLoop(); return; }
    if (e.key === 'r' || e.key === 'R') { _resetEngine(); return; }
    if (e.key === 'f' || e.key === 'F') {
        _seekTimeline(0);
        if (_gestureEngine?.debug) _gestureEngine.debug.paused = false;
        return;
    }
    // Z — shading cycle (also accessible from gestures tab)
    if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); _cycleShadingMode(); return; }
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

        // ── Skeleton overlay tick (runs every frame regardless of tab) ──
        if (_skeletonOverlay) _skeletonOverlay.update();

        if ((_studio.activeTab === 'animation' || _studio.activeTab === 'gestures') && _animEditor) {
            // AnimEditor handles its own RAF loop for playback.
            // We just need to refresh the dope sheet and numeric panel
            // when something changes (onClipChange callback handles that).
            // However, if user scrubs via the StudioDopeSheet we keep UI in sync.
            if (_animEditor.isPlaying) {
                _studioDopeSheet?.refresh();
                _updateNumericPanelUI();
                _updateSkeletonKeyedBones();
            }
        } else if (_studio.gestureSubMode === 'clips') {
            if (_studio.clipIsPlaying) {
                const dt = 0.016;
                _studio.clipPlayheadTime += dt * (_studio.speed || 1.0);
                const dur = _studio.activeClipData?.duration || 1.0;
                if (_studio.clipPlayheadTime >= dur) {
                    if (_studio.activeClipData?.loop) {
                        _studio.clipPlayheadTime = _studio.clipPlayheadTime % dur;
                    } else if (_studio.activeClipData?.holdUntilReleased) {
                        _studio.clipPlayheadTime = dur;
                    } else {
                        _studio.clipPlayheadTime = dur;
                        _studio.clipIsPlaying = false;
                    }
                }
                _evaluateActiveClipAtTime(_studio.clipPlayheadTime);
                _updateDopeSheetUI();
            }
        } else {
            _updateTimelinePlayhead();
            _updateLiveHUD(gestureEngine, armLayer);
        }
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

export function applyStudioBoneOverrides(humanoid, dt) {
    if (_animEditor) {
        _animEditor.applyStudioBoneOverrides(humanoid, dt);
    }
}