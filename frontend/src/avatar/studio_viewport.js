// ═══════════════════════════════════════════════════
//  STUDIO VIEWPORT — Skeleton Overlay & Bone Selection
//  Draws Blender-style joint spheres + sticks on top of
//  the VRM mesh. Handles raycaster click-to-select any
//  humanoid bone. Zero per-frame allocations.
// ═══════════════════════════════════════════════════

import * as THREE from 'three';

// ── Color palette ──
const COL_DEFAULT      = new THREE.Color(0x4488bb);
const COL_LEFT         = new THREE.Color(0x3399ff);   // blue tint
const COL_RIGHT        = new THREE.Color(0xff4466);   // red tint
const COL_HOVER        = new THREE.Color(0xffffff);
const COL_SELECTED     = new THREE.Color(0xff8800);   // Blender orange
const COL_ACTIVE       = new THREE.Color(0xffbb44);   // lighter orange
const COL_KEYED        = new THREE.Color(0xffee00);   // yellow ring
const COL_STICK        = new THREE.Color(0x223344);
const COL_STICK_LEFT   = new THREE.Color(0x223366);
const COL_STICK_RIGHT  = new THREE.Color(0x441122);

// ── Scratch objects ──
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _box = new THREE.Box3();

// ── All humanoid bones we want to show ──
export const ALL_HUMANOID_BONES = [
    // Spine
    'hips','spine','chest','upperChest',
    // Head
    'neck','head',
    // Eyes
    'leftEye','rightEye',
    // Shoulders & arms
    'leftShoulder','rightShoulder',
    'leftUpperArm','rightUpperArm',
    'leftLowerArm','rightLowerArm',
    'leftHand','rightHand',
    // Left fingers
    'leftThumbMetacarpal','leftThumbProximal','leftThumbDistal',
    'leftIndexProximal','leftIndexIntermediate','leftIndexDistal',
    'leftMiddleProximal','leftMiddleIntermediate','leftMiddleDistal',
    'leftRingProximal','leftRingIntermediate','leftRingDistal',
    'leftLittleProximal','leftLittleIntermediate','leftLittleDistal',
    // Right fingers
    'rightThumbMetacarpal','rightThumbProximal','rightThumbDistal',
    'rightIndexProximal','rightIndexIntermediate','rightIndexDistal',
    'rightMiddleProximal','rightMiddleIntermediate','rightMiddleDistal',
    'rightRingProximal','rightRingIntermediate','rightRingDistal',
    'rightLittleProximal','rightLittleIntermediate','rightLittleDistal',
    // Legs
    'leftUpperLeg','rightUpperLeg',
    'leftLowerLeg','rightLowerLeg',
    'leftFoot','rightFoot',
    'leftToes','rightToes',
];

// ── Bone hierarchy parent map (VRM 1.0 convention) ──
// Used for drawing sticks from parent joint to child joint
const PARENT_MAP = {
    spine: 'hips', chest: 'spine', upperChest: 'chest',
    neck: 'upperChest', head: 'neck',
    leftEye: 'head', rightEye: 'head',
    leftShoulder: 'upperChest', rightShoulder: 'upperChest',
    leftUpperArm: 'leftShoulder', rightUpperArm: 'rightShoulder',
    leftLowerArm: 'leftUpperArm', rightLowerArm: 'rightUpperArm',
    leftHand: 'leftLowerArm', rightHand: 'rightLowerArm',
    // Left fingers
    leftThumbMetacarpal: 'leftHand', leftThumbProximal: 'leftThumbMetacarpal', leftThumbDistal: 'leftThumbProximal',
    leftIndexProximal: 'leftHand', leftIndexIntermediate: 'leftIndexProximal', leftIndexDistal: 'leftIndexIntermediate',
    leftMiddleProximal: 'leftHand', leftMiddleIntermediate: 'leftMiddleProximal', leftMiddleDistal: 'leftMiddleIntermediate',
    leftRingProximal: 'leftHand', leftRingIntermediate: 'leftRingProximal', leftRingDistal: 'leftRingIntermediate',
    leftLittleProximal: 'leftHand', leftLittleIntermediate: 'leftLittleProximal', leftLittleDistal: 'leftLittleIntermediate',
    // Right fingers
    rightThumbMetacarpal: 'rightHand', rightThumbProximal: 'rightThumbMetacarpal', rightThumbDistal: 'rightThumbProximal',
    rightIndexProximal: 'rightHand', rightIndexIntermediate: 'rightIndexProximal', rightIndexDistal: 'rightIndexIntermediate',
    rightMiddleProximal: 'rightHand', rightMiddleIntermediate: 'rightMiddleProximal', rightMiddleDistal: 'rightMiddleIntermediate',
    rightRingProximal: 'rightHand', rightRingIntermediate: 'rightRingProximal', rightRingDistal: 'rightRingIntermediate',
    rightLittleProximal: 'rightHand', rightLittleIntermediate: 'rightLittleProximal', rightLittleDistal: 'rightLittleIntermediate',
    // Legs
    leftUpperLeg: 'hips', rightUpperLeg: 'hips',
    leftLowerLeg: 'leftUpperLeg', rightLowerLeg: 'rightUpperLeg',
    leftFoot: 'leftLowerLeg', rightFoot: 'rightLowerLeg',
    leftToes: 'leftFoot', rightToes: 'rightFoot',
};

function _boneSide(name) {
    if (name.startsWith('left')) return 'left';
    if (name.startsWith('right')) return 'right';
    return 'center';
}

export class SkeletonOverlay {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {HTMLElement} domElement  – the renderer's canvas
     */
    constructor(scene, camera, domElement) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;

        this.vrm = null;
        this.humanoid = null;

        this.visible = true;

        // State
        this.selectedBones = new Set();   // multi-select
        this.hoveredBone = null;
        this.keyedBones = new Set();      // bones that have keyframes at current time

        // Callbacks
        this.onSelect = null;            // (boneName, event) => void

        // Raycasting
        this._raycaster = new THREE.Raycaster();
        this._raycaster.params.Points.threshold = 0.01;
        this._mouse = new THREE.Vector2();

        // Three.js objects
        this._group = new THREE.Group();
        this._group.name = 'SkeletonOverlay';
        this._group.renderOrder = 9990;
        scene.add(this._group);

        // Per-bone sphere meshes stored in a map
        this._jointMeshes = new Map();    // boneName -> Mesh
        this._stickLines = new Map();     // boneName -> Line (from parent to this bone)
        this._keyedRings = new Map();     // boneName -> Mesh (ring indicator)

        // Shared geometries & materials (created once, reused)
        this._jointGeom = new THREE.SphereGeometry(1, 8, 6);   // unit sphere, scaled per bone
        this._ringGeom  = new THREE.TorusGeometry(1, 0.18, 6, 16);

        this._matJoint = new Map();       // boneName -> material (unique per bone for color)
        this._matStick = new THREE.LineBasicMaterial({ color: COL_STICK, depthTest: false, transparent: true, opacity: 0.6 });

        // Shared fallback mat
        this._matDefault = new THREE.MeshBasicMaterial({ color: COL_DEFAULT, depthTest: false, transparent: true, opacity: 0.88 });

        // Bind event handlers
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerDown = this._onPointerDown.bind(this);
        domElement.addEventListener('pointermove', this._onPointerMove);
        domElement.addEventListener('pointerdown', this._onPointerDown);
    }

    setVRM(vrm) {
        this.vrm = vrm;
        this.humanoid = vrm?.humanoid || null;
        this._buildSkeletonMeshes();
    }

    setKeyedBones(boneNameSet) {
        this.keyedBones = boneNameSet instanceof Set ? boneNameSet : new Set(boneNameSet);
        this._updateRings();
    }

    selectBone(boneName, addToSelection = false) {
        if (!addToSelection) this.selectedBones.clear();
        if (boneName) {
            if (this.selectedBones.has(boneName) && addToSelection) {
                this.selectedBones.delete(boneName);
            } else {
                this.selectedBones.add(boneName);
            }
        }
        this._refreshColors();
    }

    selectAll() {
        ALL_HUMANOID_BONES.forEach(b => {
            if (this.humanoid?.getNormalizedBoneNode(b)) this.selectedBones.add(b);
        });
        this._refreshColors();
    }

    deselectAll() {
        this.selectedBones.clear();
        this._refreshColors();
    }

    /** Set selection from an external Set (e.g. StudioOutliner, AnimEditor). */
    setSelectedBones(boneSet) {
        this.selectedBones = boneSet instanceof Set ? new Set(boneSet) : new Set(boneSet || []);
        this._refreshColors();
    }

    show()  { this.visible = true;  this._group.visible = true; }
    hide()  { this.visible = false; this._group.visible = false; }
    toggle(){ this.visible ? this.hide() : this.show(); }

    /** Toggle a single bone's sphere visibility (for outliner eye icon). */
    toggleBoneVisibility(boneName) {
        const mesh = this._jointMeshes.get(boneName);
        if (mesh) mesh.visible = !mesh.visible;
        const line = this._stickLines.get(boneName);
        if (line) line.visible = mesh ? mesh.visible : true;
    }

    dispose() {
        this.domElement.removeEventListener('pointermove', this._onPointerMove);
        this.domElement.removeEventListener('pointerdown', this._onPointerDown);
        this.scene.remove(this._group);
    }

    // ── Build / Rebuild ─────────────────────────────

    _buildSkeletonMeshes() {
        // Remove old
        this._group.clear();
        this._jointMeshes.clear();
        this._stickLines.clear();
        this._keyedRings.clear();
        this._matJoint.clear();

        if (!this.humanoid) return;

        for (const boneName of ALL_HUMANOID_BONES) {
            const node = this.humanoid.getNormalizedBoneNode(boneName);
            if (!node) continue;

            const side = _boneSide(boneName);
            const baseColor = side === 'left' ? COL_LEFT : side === 'right' ? COL_RIGHT : COL_DEFAULT;

            // Joint sphere material (unique per bone so we can tint individually)
            const mat = new THREE.MeshBasicMaterial({
                color: baseColor.clone(),
                depthTest: false,
                transparent: true,
                opacity: 0.92,
            });
            this._matJoint.set(boneName, mat);

            // Scale sphere: smaller for fingers & eyes
            const isFinger = boneName.match(/(Thumb|Index|Middle|Ring|Little)/);
            const isEye = boneName.includes('Eye');
            const r = isEye ? 0.008 : isFinger ? 0.007 : 0.013;

            const sphere = new THREE.Mesh(this._jointGeom, mat);
            sphere.scale.setScalar(r);
            sphere.renderOrder = 9991;
            sphere.userData.boneName = boneName;
            this._jointMeshes.set(boneName, sphere);
            this._group.add(sphere);

            // Keyed ring (hidden by default)
            const ringMat = new THREE.MeshBasicMaterial({
                color: COL_KEYED,
                depthTest: false,
                transparent: true,
                opacity: 0.85,
            });
            const ring = new THREE.Mesh(this._ringGeom, ringMat);
            ring.scale.setScalar(r * 1.6);
            ring.visible = false;
            ring.renderOrder = 9992;
            this._keyedRings.set(boneName, ring);
            this._group.add(ring);

            // Stick from parent to this bone
            const parentName = PARENT_MAP[boneName];
            if (parentName && this.humanoid.getNormalizedBoneNode(parentName)) {
                const sideColor = side === 'left' ? COL_STICK_LEFT : side === 'right' ? COL_STICK_RIGHT : COL_STICK;
                const lineMat = new THREE.LineBasicMaterial({
                    color: sideColor,
                    depthTest: false,
                    transparent: true,
                    opacity: 0.55,
                });
                const lineGeom = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(), new THREE.Vector3()
                ]);
                const line = new THREE.Line(lineGeom, lineMat);
                line.renderOrder = 9990;
                line.frustumCulled = false;
                this._stickLines.set(boneName, line);
                this._group.add(line);
            }
        }

        this._refreshColors();
    }

    // ── Per-frame update ─────────────────────────────

    update() {
        if (!this.visible || !this.humanoid) return;

        for (const boneName of ALL_HUMANOID_BONES) {
            const node = this.humanoid.getNormalizedBoneNode(boneName);
            const sphere = this._jointMeshes.get(boneName);
            if (!node || !sphere) continue;

            // Get world position of bone node
            node.getWorldPosition(_v1);
            sphere.position.copy(_v1);

            // Ring follows sphere
            const ring = this._keyedRings.get(boneName);
            if (ring) {
                ring.position.copy(_v1);
                // Keep ring facing camera
                ring.quaternion.copy(this.camera.quaternion);
            }

            // Update stick
            const line = this._stickLines.get(boneName);
            if (line) {
                const parentName = PARENT_MAP[boneName];
                const parentNode = parentName ? this.humanoid.getNormalizedBoneNode(parentName) : null;
                if (parentNode) {
                    parentNode.getWorldPosition(_v2);
                    const pos = line.geometry.attributes.position;
                    pos.setXYZ(0, _v2.x, _v2.y, _v2.z);
                    pos.setXYZ(1, _v1.x, _v1.y, _v1.z);
                    pos.needsUpdate = true;
                }
            }
        }
    }

    // ── Color refresh ─────────────────────────────────

    _refreshColors() {
        for (const [boneName, mat] of this._matJoint) {
            const side = _boneSide(boneName);
            const isSelected = this.selectedBones.has(boneName);
            const isHovered  = boneName === this.hoveredBone;
            const isFirst    = isSelected && boneName === [...this.selectedBones].at(-1); // last = "active"

            let color, opacity;
            if (isHovered && !isSelected) {
                color = COL_HOVER; opacity = 1.0;
            } else if (isFirst) {
                color = COL_ACTIVE; opacity = 1.0;
            } else if (isSelected) {
                color = COL_SELECTED; opacity = 1.0;
            } else {
                color = side === 'left' ? COL_LEFT : side === 'right' ? COL_RIGHT : COL_DEFAULT;
                opacity = 0.88;
            }
            mat.color.set(color);
            mat.opacity = opacity;
        }
    }

    _updateRings() {
        for (const [boneName, ring] of this._keyedRings) {
            ring.visible = this.keyedBones.has(boneName);
        }
    }

    // ── Raycasting ───────────────────────────────────

    _getMouseNDC(event) {
        const rect = this.domElement.getBoundingClientRect();
        this._mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        this._mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
    }

    _raycastBones() {
        this._raycaster.setFromCamera(this._mouse, this.camera);
        const targets = [];
        for (const [, mesh] of this._jointMeshes) {
            if (mesh.visible) targets.push(mesh);
        }
        const hits = this._raycaster.intersectObjects(targets, false);
        if (hits.length > 0) return hits[0].object.userData.boneName;
        return null;
    }

    _onPointerMove(event) {
        if (!this.visible) return;
        this._getMouseNDC(event);
        const hit = this._raycastBones();
        if (hit !== this.hoveredBone) {
            this.hoveredBone = hit;
            this._refreshColors();
            this.domElement.style.cursor = hit ? 'pointer' : '';
        }
    }

    _onPointerDown(event) {
        if (!this.visible) return;
        if (event.button !== 0) return;          // left click only
        if (event.altKey) return;                // Alt+LMB is orbit

        this._getMouseNDC(event);
        const hit = this._raycastBones();

        if (hit) {
            event.stopPropagation();
            const additive = event.shiftKey;
            this.selectBone(hit, additive);
            if (this.onSelect) this.onSelect(hit, event);
        } else {
            // Click on empty = deselect
            if (!event.shiftKey) {
                this.deselectAll();
                if (this.onSelect) this.onSelect(null, event);
            }
        }
    }
}

// ═══════════════════════════════════════════════════
//  VIEWPORT SHADING MANAGER
// ═══════════════════════════════════════════════════

export class ViewportShading {
    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {THREE.Scene} scene
     */
    constructor(renderer, scene) {
        this.renderer = renderer;
        this.scene = scene;
        this._mode = 'solid';   // 'solid' | 'wireframe' | 'xray'
        this._meshMaterials = new Map();  // original mesh materials backup
    }

    setMode(mode) {
        if (mode === this._mode) return;
        this._restore();
        this._mode = mode;

        if (mode === 'wireframe') {
            this._applyWireframe();
        } else if (mode === 'xray') {
            this._applyXray();
        }
        // 'solid' = restored above
    }

    getMode() { return this._mode; }

    _applyWireframe() {
        this.scene.traverse(obj => {
            if (obj.isMesh && !obj.userData.studioOverlay) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                this._meshMaterials.set(obj.uuid, mats.map(m => m));
                const wf = mats.map(m => {
                    const clone = m.clone();
                    clone.wireframe = true;
                    return clone;
                });
                obj.material = wf.length === 1 ? wf[0] : wf;
            }
        });
    }

    _applyXray() {
        this.scene.traverse(obj => {
            if (obj.isMesh && !obj.userData.studioOverlay) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                this._meshMaterials.set(obj.uuid, mats.map(m => m));
                const xr = mats.map(m => {
                    const clone = m.clone();
                    clone.transparent = true;
                    clone.opacity = 0.25;
                    clone.depthWrite = false;
                    return clone;
                });
                obj.material = xr.length === 1 ? xr[0] : xr;
            }
        });
    }

    _restore() {
        if (this._meshMaterials.size === 0) return;
        this.scene.traverse(obj => {
            if (obj.isMesh && this._meshMaterials.has(obj.uuid)) {
                const origMats = this._meshMaterials.get(obj.uuid);
                // Dispose cloned materials
                const cur = Array.isArray(obj.material) ? obj.material : [obj.material];
                cur.forEach(m => m.dispose?.());
                obj.material = origMats.length === 1 ? origMats[0] : origMats;
            }
        });
        this._meshMaterials.clear();
    }
}
