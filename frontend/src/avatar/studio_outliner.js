// ═══════════════════════════════════════════════════
//  STUDIO OUTLINER — Blender-Style Bone Hierarchy Tree
//  Displays all humanoid bones grouped / hierarchically.
//  Supports search filtering, group selection buttons,
//  visibility (eye), selection locking (lock), and keyframe indicators.
// ═══════════════════════════════════════════════════

import { ALL_HUMANOID_BONES } from './studio_viewport.js';
import { BONE_GROUPS } from './studio_anim_editor.js';

export class StudioOutliner {
    /**
     * @param {HTMLElement} container
     * @param {object} opts
     * @param {function(string, boolean): void} opts.onSelectBone - (boneName, additive)
     * @param {function(string): void} [opts.onToggleVisibility] - (boneName)
     * @param {function(string): void} [opts.onToggleLock] - (boneName)
     */
    constructor(container, opts = {}) {
        this.container = container;
        this.onSelectBone = opts.onSelectBone || null;
        this.onToggleVisibility = opts.onToggleVisibility || null;
        this.onToggleLock = opts.onToggleLock || null;

        this.searchQuery = '';
        this.selectedBones = new Set();
        this.lockedBones = new Set();
        this.hiddenBones = new Set();
        this.keyedBones = new Set();
        this.collapsedGroups = new Set();

        this._groupOrder = [
            'Head & Neck',
            'Spine',
            'Left Arm',
            'Right Arm',
            'Left Fingers',
            'Right Fingers',
            'Left Leg',
            'Right Leg'
        ];

        this._render();
    }

    setSelection(selectedSet) {
        this.selectedBones = selectedSet instanceof Set ? new Set(selectedSet) : new Set(selectedSet || []);
        this._updateSelectionHighlight();
    }

    setKeyedBones(keyedSet) {
        this.keyedBones = keyedSet instanceof Set ? new Set(keyedSet) : new Set(keyedSet || []);
        this._updateKeyIcons();
    }

    setLockedBones(lockedSet) {
        this.lockedBones = lockedSet instanceof Set ? new Set(lockedSet) : new Set(lockedSet || []);
        this._updateLockIcons();
    }

    setHiddenBones(hiddenSet) {
        this.hiddenBones = hiddenSet instanceof Set ? new Set(hiddenSet) : new Set(hiddenSet || []);
        this._updateEyeIcons();
    }

    isLocked(boneName) {
        return this.lockedBones.has(boneName);
    }

    selectGroup(groupName, additive = false) {
        const bones = BONE_GROUPS[groupName] || [];
        if (!additive) this.selectedBones.clear();
        for (const b of bones) {
            if (!this.lockedBones.has(b)) {
                this.selectedBones.add(b);
            }
        }
        this._updateSelectionHighlight();
        if (this.onSelectBone) {
            const first = bones.find(b => !this.lockedBones.has(b));
            this.onSelectBone(first || null, additive);
        }
    }

    _render() {
        this.container.innerHTML = `
            <div class="studio-outliner">
                <div class="outliner-header">
                    <div class="outliner-title">Outliner (Bones)</div>
                    <div class="outliner-search-wrap">
                        <input type="text" class="outliner-search-input" placeholder="Search bones... (A / Alt+A)" />
                    </div>
                    <div class="outliner-quick-groups">
                        <button type="button" class="group-btn" data-grp="Head & Neck" title="Select Head & Neck">Head</button>
                        <button type="button" class="group-btn" data-grp="Spine" title="Select Torso/Spine">Torso</button>
                        <button type="button" class="group-btn" data-grp="Left Arm" title="Select Left Arm">L-Arm</button>
                        <button type="button" class="group-btn" data-grp="Right Arm" title="Select Right Arm">R-Arm</button>
                        <button type="button" class="group-btn" data-grp="Left Fingers" title="Select Left Fingers">L-Fingers</button>
                        <button type="button" class="group-btn" data-grp="Right Fingers" title="Select Right Fingers">R-Fingers</button>
                        <button type="button" class="group-btn" data-grp="Left Leg" title="Select Left Leg">L-Leg</button>
                        <button type="button" class="group-btn" data-grp="Right Leg" title="Select Right Leg">R-Leg</button>
                    </div>
                </div>
                <div class="outliner-tree" id="outliner-tree-list"></div>
            </div>
        `;

        const searchInput = this.container.querySelector('.outliner-search-input');
        searchInput.addEventListener('input', (e) => {
            this.searchQuery = (e.target.value || '').trim().toLowerCase();
            this._renderTree();
        });

        this.container.querySelectorAll('.group-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const grp = btn.dataset.grp;
                this.selectGroup(grp, e.shiftKey);
            });
        });

        this._treeListEl = this.container.querySelector('#outliner-tree-list');
        this._renderTree();
    }

    _renderTree() {
        if (!this._treeListEl) return;
        const q = this.searchQuery;
        let html = '';

        for (const groupName of this._groupOrder) {
            const bones = BONE_GROUPS[groupName] || [];
            const filteredBones = q
                ? bones.filter(b => b.toLowerCase().includes(q) || groupName.toLowerCase().includes(q))
                : bones;

            if (q && filteredBones.length === 0) continue;

            const isCollapsed = this.collapsedGroups.has(groupName);
            const groupKeyCount = bones.filter(b => this.keyedBones.has(b)).length;

            html += `
                <div class="outliner-group ${isCollapsed ? 'collapsed' : ''}" data-group="${groupName}">
                    <div class="outliner-group-row">
                        <span class="group-caret">${isCollapsed ? '▶' : '▼'}</span>
                        <span class="group-label">${groupName}</span>
                        ${groupKeyCount > 0 ? `<span class="group-key-badge" title="${groupKeyCount} keyed bones">● ${groupKeyCount}</span>` : ''}
                        <button type="button" class="group-select-all" title="Select group bones">select</button>
                    </div>
                    <div class="outliner-group-items" style="${isCollapsed ? 'display: none;' : ''}">
            `;

            for (const boneName of filteredBones) {
                const isSelected = this.selectedBones.has(boneName);
                const isKeyed = this.keyedBones.has(boneName);
                const isLocked = this.lockedBones.has(boneName);
                const isHidden = this.hiddenBones.has(boneName);
                const isLeft = boneName.startsWith('left');
                const isRight = boneName.startsWith('right');
                const sideClass = isLeft ? 'side-left' : (isRight ? 'side-right' : 'side-center');

                html += `
                    <div class="outliner-bone-row ${isSelected ? 'selected' : ''} ${sideClass} ${isLocked ? 'locked' : ''}" data-bone="${boneName}">
                        <div class="bone-icons">
                            <span class="icon-btn icon-eye ${isHidden ? 'active' : ''}" title="${isHidden ? 'Show in viewport' : 'Hide in viewport'}">${isHidden ? '🙈' : '👁️'}</span>
                            <span class="icon-btn icon-lock ${isLocked ? 'active' : ''}" title="${isLocked ? 'Unlock bone' : 'Lock bone'}">${isLocked ? '🔒' : '🔓'}</span>
                            <span class="icon-btn icon-key ${isKeyed ? 'active' : ''}" title="${isKeyed ? 'Has keyframes in clip' : 'No keyframes'}">${isKeyed ? '♦' : '♢'}</span>
                        </div>
                        <span class="bone-name">${boneName}</span>
                    </div>
                `;
            }

            html += `
                    </div>
                </div>
            `;
        }

        this._treeListEl.innerHTML = html || '<div class="outliner-empty">No matching bones</div>';
        this._bindTreeEvents();
    }

    _bindTreeEvents() {
        if (!this._treeListEl) return;

        // Group caret toggle
        this._treeListEl.querySelectorAll('.outliner-group-row').forEach(row => {
            const grpEl = row.closest('.outliner-group');
            const grpName = grpEl?.dataset.group;

            row.addEventListener('click', (e) => {
                if (e.target.closest('.group-select-all')) {
                    e.stopPropagation();
                    this.selectGroup(grpName, e.shiftKey);
                    return;
                }
                if (this.collapsedGroups.has(grpName)) {
                    this.collapsedGroups.delete(grpName);
                } else {
                    this.collapsedGroups.add(grpName);
                }
                this._renderTree();
            });
        });

        // Bone row actions
        this._treeListEl.querySelectorAll('.outliner-bone-row').forEach(row => {
            const boneName = row.dataset.bone;

            row.addEventListener('click', (e) => {
                // Eye button
                if (e.target.closest('.icon-eye')) {
                    e.stopPropagation();
                    if (this.hiddenBones.has(boneName)) this.hiddenBones.delete(boneName);
                    else this.hiddenBones.add(boneName);
                    this._updateEyeIcons();
                    this.onToggleVisibility?.(boneName);
                    return;
                }
                // Lock button
                if (e.target.closest('.icon-lock')) {
                    e.stopPropagation();
                    if (this.lockedBones.has(boneName)) this.lockedBones.delete(boneName);
                    else {
                        this.lockedBones.add(boneName);
                        this.selectedBones.delete(boneName);
                    }
                    this._updateLockIcons();
                    this._updateSelectionHighlight();
                    this.onToggleLock?.(boneName);
                    return;
                }
                // Key icon click - select keyframe or no-op
                if (e.target.closest('.icon-key')) {
                    // fall-through to selection
                }

                if (this.lockedBones.has(boneName)) return;

                const additive = e.shiftKey;
                if (!additive) {
                    this.selectedBones.clear();
                    this.selectedBones.add(boneName);
                } else {
                    if (this.selectedBones.has(boneName)) {
                        this.selectedBones.delete(boneName);
                    } else {
                        this.selectedBones.add(boneName);
                    }
                }
                this._updateSelectionHighlight();
                this.onSelectBone?.(boneName, additive);
            });
        });
    }

    _updateSelectionHighlight() {
        if (!this._treeListEl) return;
        this._treeListEl.querySelectorAll('.outliner-bone-row').forEach(row => {
            const b = row.dataset.bone;
            if (this.selectedBones.has(b)) {
                row.classList.add('selected');
            } else {
                row.classList.remove('selected');
            }
        });
    }

    _updateKeyIcons() {
        if (!this._treeListEl) return;
        this._treeListEl.querySelectorAll('.outliner-bone-row').forEach(row => {
            const b = row.dataset.bone;
            const keyEl = row.querySelector('.icon-key');
            if (keyEl) {
                const isKeyed = this.keyedBones.has(b);
                keyEl.classList.toggle('active', isKeyed);
                keyEl.textContent = isKeyed ? '♦' : '♢';
            }
        });
        this._treeListEl.querySelectorAll('.outliner-group').forEach(grp => {
            const grpName = grp.dataset.group;
            const bones = BONE_GROUPS[grpName] || [];
            const count = bones.filter(b => this.keyedBones.has(b)).length;
            let badge = grp.querySelector('.group-key-badge');
            if (count > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'group-key-badge';
                    grp.querySelector('.outliner-group-row').appendChild(badge);
                }
                badge.textContent = `● ${count}`;
                badge.title = `${count} keyed bones`;
            } else if (badge) {
                badge.remove();
            }
        });
    }

    _updateLockIcons() {
        if (!this._treeListEl) return;
        this._treeListEl.querySelectorAll('.outliner-bone-row').forEach(row => {
            const b = row.dataset.bone;
            const isLocked = this.lockedBones.has(b);
            row.classList.toggle('locked', isLocked);
            const lockEl = row.querySelector('.icon-lock');
            if (lockEl) {
                lockEl.classList.toggle('active', isLocked);
                lockEl.textContent = isLocked ? '🔒' : '🔓';
            }
        });
    }

    _updateEyeIcons() {
        if (!this._treeListEl) return;
        this._treeListEl.querySelectorAll('.outliner-bone-row').forEach(row => {
            const b = row.dataset.bone;
            const isHidden = this.hiddenBones.has(b);
            const eyeEl = row.querySelector('.icon-eye');
            if (eyeEl) {
                eyeEl.classList.toggle('active', isHidden);
                eyeEl.textContent = isHidden ? '🙈' : '👁️';
            }
        });
    }
}
