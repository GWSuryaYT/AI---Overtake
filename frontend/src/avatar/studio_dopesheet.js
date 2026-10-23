// ═══════════════════════════════════════════════════
//  STUDIO DOPESHEET & TIMELINE
//  Blender-style dope sheet with per-bone tracks, diamond keys,
//  draggable keyframe timing, playhead scrubbing, transport controls,
//  and full timing adjustment (edit time, delta to next, scale, interp).
// ═══════════════════════════════════════════════════

export class StudioDopeSheet {
    /**
     * @param {HTMLElement} container
     * @param {object} opts
     * @param {import('./studio_anim_editor.js').AnimEditor} opts.animEditor
     * @param {function(): void} [opts.onUpdate]
     */
    constructor(container, opts = {}) {
        this.container = container;
        this.editor = opts.animEditor;
        this.onUpdate = opts.onUpdate || null;

        this.selectedKey = null; // { boneName, index, t } or 'summary'
        this._isScrubbing = false;
        this._dragKey = null;   // { boneName, index, startT, startClientX }

        this._render();
    }

    refresh() {
        this._updatePlayheadVisuals();
        this._renderTracks();
        this._updateSelectedKeyInspector();
    }

    _render() {
        this.container.innerHTML = `
            <div class="studio-dopesheet">
                <!-- Transport & Timeline Toolbar -->
                <div class="dopesheet-toolbar">
                    <div class="transport-controls">
                        <button type="button" class="btn-transport" id="btn-jump-start" title="Jump to Start (0s)">⏮</button>
                        <button type="button" class="btn-transport" id="btn-prev-key" title="Previous Keyframe ([)">◀|</button>
                        <button type="button" class="btn-transport btn-play-pause" id="btn-play" title="Play / Pause (Space)">▶</button>
                        <button type="button" class="btn-transport" id="btn-stop" title="Stop">⏹</button>
                        <button type="button" class="btn-transport" id="btn-next-key" title="Next Keyframe (])">|▶</button>
                        <button type="button" class="btn-transport" id="btn-jump-end" title="Jump to End">⏭</button>
                    </div>

                    <div class="transport-settings">
                        <!-- Auto-Key Toggle -->
                        <button type="button" class="btn-autokey ${this.editor?.autoKey ? 'active' : ''}" id="btn-autokey" title="Auto-Keying: Record changes when moving bones">
                            <span class="autokey-dot">●</span> Auto-Key
                        </button>

                        <!-- Loop toggle -->
                        <label class="dopesheet-check-label" title="Loop playback">
                            <input type="checkbox" id="chk-loop" ${this.editor?.clip?.loop ? 'checked' : ''} /> Loop
                        </label>

                        <!-- Speed selector -->
                        <div class="speed-select-wrap">
                            <span class="speed-label">Speed:</span>
                            <select id="sel-speed" class="dopesheet-select">
                                <option value="0.25">0.25x</option>
                                <option value="0.5">0.5x</option>
                                <option value="1.0" selected>1.0x</option>
                                <option value="1.5">1.5x</option>
                                <option value="2.0">2.0x</option>
                            </select>
                        </div>

                        <!-- Current Time / Duration -->
                        <div class="time-display-wrap">
                            <span class="time-readout" id="time-readout">0.00s</span> /
                            <input type="number" id="inp-duration" class="num-input duration-input" step="0.1" min="0.2" max="60.0" value="${this.editor?.clip?.duration || 2.0}" title="Total clip duration (seconds)" />s
                        </div>
                    </div>

                    <div class="keyframe-quick-actions">
                        <button type="button" class="btn-key-action" id="btn-insert-key" title="Insert Keyframe on selected bones at playhead (I)">+ Key (I)</button>
                        <button type="button" class="btn-key-action btn-danger" id="btn-delete-key" title="Delete Keyframe at playhead (Alt+I)">- Key (Alt+I)</button>
                    </div>
                </div>

                <!-- Timeline Body: Left Track Labels, Right Track Diamonds -->
                <div class="dopesheet-body">
                    <div class="dopesheet-labels-col">
                        <div class="label-row summary-label">Summary (All Keys)</div>
                        <div class="track-labels-list" id="track-labels-list"></div>
                    </div>

                    <div class="dopesheet-timeline-col" id="timeline-scroll-area">
                        <!-- Ruler with time numbers -->
                        <div class="timeline-ruler" id="timeline-ruler">
                            <div class="ruler-marks" id="ruler-marks"></div>
                            <!-- Playhead line -->
                            <div class="playhead-line" id="playhead-line">
                                <div class="playhead-head">▼</div>
                            </div>
                        </div>

                        <!-- Track rows with diamonds -->
                        <div class="timeline-tracks-wrap" id="timeline-tracks-wrap">
                            <div class="track-row summary-track" id="summary-track"></div>
                            <div class="bone-tracks-list" id="bone-tracks-list"></div>
                        </div>
                    </div>
                </div>

                <!-- Bottom Keyframe Inspector (Full timing and interpolation editing) -->
                <div class="keyframe-inspector" id="keyframe-inspector">
                    <div class="inspector-empty" id="inspector-empty">Click a diamond keyframe to edit its exact time, timing to next key, or curve.</div>
                    <div class="inspector-content" id="inspector-content" style="display: none;">
                        <span class="inspector-title" id="inspector-bone-label">Bone: None</span>

                        <div class="inspector-field">
                            <label>Exact Time:</label>
                            <input type="number" id="insp-time-input" class="num-input" step="0.01" min="0" />s
                        </div>

                        <div class="inspector-field">
                            <label>Next Key Gap:</label>
                            <button type="button" class="btn-gap-step" id="btn-gap-shrink" title="Shorten gap to next key (-0.1s)">- 0.1s</button>
                            <input type="number" id="insp-gap-input" class="num-input" step="0.05" min="0.05" style="width: 58px; text-align: center;" title="Edit exact gap duration to next key in seconds" />s
                            <button type="button" class="btn-gap-step" id="btn-gap-expand" title="Extend gap to next key (+0.1s)">+ 0.1s</button>
                            <button type="button" class="btn-gap-step" id="btn-gap-expand-large" title="Extend gap to next key (+0.25s)">+ 0.25s</button>
                        </div>

                        <div class="inspector-field" style="display:flex; align-items:center; gap:6px;">
                            <label style="cursor:pointer; display:flex; align-items:center; gap:5px; font-size:11px; color:#38bdf8; font-weight:600;">
                                <input type="checkbox" id="chk-sync-all-tracks" checked />
                                <span>Sync All Tracks (Whole Pose)</span>
                            </label>
                        </div>

                        <div class="inspector-field">
                            <label>Interpolation:</label>
                            <select id="insp-interp-select" class="dopesheet-select">
                                <option value="smooth">Smooth (Catmull-Rom / Slerp)</option>
                                <option value="linear">Linear</option>
                                <option value="constant">Constant (Hold)</option>
                                <option value="easeIn">Ease In</option>
                                <option value="easeOut">Ease Out</option>
                            </select>
                        </div>

                        <div class="inspector-actions">
                            <button type="button" class="btn-insp-action" id="btn-duplicate-key" title="Duplicate key to current playhead (Shift+D)">Duplicate</button>
                            <button type="button" class="btn-insp-action btn-danger" id="btn-del-selected-key" title="Delete this keyframe">Delete</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this._bindEvents();
        this._renderRuler();
        this._renderTracks();
    }

    _bindEvents() {
        const root = this.container;

        // Transport buttons
        root.querySelector('#btn-play')?.addEventListener('click', () => {
            if (this.editor.isPlaying) {
                this.editor.pause();
            } else {
                this.editor.play();
            }
            this._updatePlayButton();
        });

        root.querySelector('#btn-stop')?.addEventListener('click', () => {
            this.editor.stop();
            this._updatePlayButton();
            this.refresh();
        });

        root.querySelector('#btn-prev-key')?.addEventListener('click', () => {
            this.editor.prevKeyframe();
            this.refresh();
        });

        root.querySelector('#btn-next-key')?.addEventListener('click', () => {
            this.editor.nextKeyframe();
            this.refresh();
        });

        root.querySelector('#btn-jump-start')?.addEventListener('click', () => {
            this.editor.seek(0);
            this.refresh();
        });

        root.querySelector('#btn-jump-end')?.addEventListener('click', () => {
            this.editor.seek(this.editor.clip.duration || 1.0);
            this.refresh();
        });

        // Auto-key
        const btnAutoKey = root.querySelector('#btn-autokey');
        btnAutoKey?.addEventListener('click', () => {
            this.editor.autoKey = !this.editor.autoKey;
            btnAutoKey.classList.toggle('active', this.editor.autoKey);
        });

        // Loop
        root.querySelector('#chk-loop')?.addEventListener('change', (e) => {
            if (this.editor.clip) this.editor.clip.loop = e.target.checked;
        });

        // Duration
        root.querySelector('#inp-duration')?.addEventListener('change', (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && val > 0.1 && this.editor.clip) {
                this.editor.clip.duration = Math.round(val * 100) / 100;
                this._renderRuler();
                this._renderTracks();
                this.onUpdate?.();
            }
        });

        // Insert / Delete key buttons
        root.querySelector('#btn-insert-key')?.addEventListener('click', () => {
            this.editor.insertKeyframe();
            this.refresh();
            this.onUpdate?.();
        });

        root.querySelector('#btn-delete-key')?.addEventListener('click', () => {
            this.editor.deleteKeyframe();
            this.refresh();
            this.onUpdate?.();
        });

        // Timeline Ruler Scrubbing
        const ruler = root.querySelector('#timeline-ruler');
        ruler?.addEventListener('pointerdown', (e) => {
            this._isScrubbing = true;
            this._handleScrub(e);
            const onPointerMove = (ev) => {
                if (this._isScrubbing) this._handleScrub(ev);
            };
            const onPointerUp = () => {
                this._isScrubbing = false;
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
            };
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
        });

        // Keyframe Inspector bindings
        const timeInput = root.querySelector('#insp-time-input');
        timeInput?.addEventListener('change', (e) => {
            const newT = parseFloat(e.target.value);
            if (isNaN(newT) || !this.selectedKey || !this.editor.clip) return;
            const { boneName, index, t: oldT } = this.selectedKey;
            const syncAll = !!root.querySelector('#chk-sync-all-tracks')?.checked;
            const targetT = Math.max(0, Math.round(newT * 1000) / 1000);

            if (targetT > (this.editor.clip.duration || 1.0)) {
                this.editor.clip.duration = Math.round((targetT + 0.2) * 10) / 10;
                const durInp = root.querySelector('#inp-duration');
                if (durInp) durInp.value = this.editor.clip.duration;
            }

            if (syncAll) {
                for (const tr of Object.values(this.editor.clip.tracks)) {
                    for (const k of tr) {
                        if (Math.abs(k.t - oldT) < 0.02) {
                            k.t = targetT;
                        }
                    }
                    tr.sort((a, b) => a.t - b.t);
                }
            } else {
                const track = this.editor.clip.tracks[boneName];
                if (track && track[index]) {
                    track[index].t = targetT;
                    track.sort((a, b) => a.t - b.t);
                }
            }

            this.selectedKey.t = targetT;
            this.editor.seek(targetT);
            this.refresh();
            this.onUpdate?.();
        });

        // Gap adjustment buttons (+0.1s / +0.25s / -0.1s to next keyframe)
        root.querySelector('#btn-gap-expand')?.addEventListener('click', () => {
            this._adjustKeyDelta(0.1);
        });

        root.querySelector('#btn-gap-expand-large')?.addEventListener('click', () => {
            this._adjustKeyDelta(0.25);
        });

        root.querySelector('#btn-gap-shrink')?.addEventListener('click', () => {
            this._adjustKeyDelta(-0.1);
        });

        // Exact gap numerical input change
        const gapInput = root.querySelector('#insp-gap-input');
        gapInput?.addEventListener('change', (e) => {
            const targetGap = parseFloat(e.target.value);
            if (isNaN(targetGap) || targetGap < 0.02 || !this.selectedKey || !this.editor.clip) return;
            const { boneName, index } = this.selectedKey;
            const track = this.editor.clip.tracks[boneName];
            if (!track || !track[index] || !track[index + 1]) return;
            const currentGap = track[index + 1].t - track[index].t;
            const delta = targetGap - currentGap;
            this._adjustKeyDelta(delta);
        });

        const interpSelect = root.querySelector('#insp-interp-select');
        interpSelect?.addEventListener('change', (e) => {
            if (!this.selectedKey || !this.editor.clip) return;
            const { boneName, index } = this.selectedKey;
            const track = this.editor.clip.tracks[boneName];
            if (track && track[index]) {
                track[index].interp = e.target.value;
                this.refresh();
                this.onUpdate?.();
            }
        });

        root.querySelector('#btn-del-selected-key')?.addEventListener('click', () => {
            if (!this.selectedKey || !this.editor.clip) return;
            const { boneName, index } = this.selectedKey;
            const track = this.editor.clip.tracks[boneName];
            if (track) {
                track.splice(index, 1);
                if (track.length === 0) delete this.editor.clip.tracks[boneName];
                this.selectedKey = null;
                this.refresh();
                this.onUpdate?.();
            }
        });

        root.querySelector('#btn-duplicate-key')?.addEventListener('click', () => {
            if (!this.selectedKey || !this.editor.clip) return;
            const { boneName, index } = this.selectedKey;
            const track = this.editor.clip.tracks[boneName];
            if (track && track[index]) {
                const src = track[index];
                const newKey = {
                    t: Math.round(this.editor.playheadTime * 1000) / 1000,
                    rot: [...src.rot],
                    interp: src.interp || 'smooth'
                };
                track.push(newKey);
                track.sort((a, b) => a.t - b.t);
                this.refresh();
                this.onUpdate?.();
            }
        });
    }

    _handleScrub(event) {
        const ruler = this.container.querySelector('#timeline-ruler');
        if (!ruler) return;
        const rect = ruler.getBoundingClientRect();
        const norm = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const dur = this.editor.clip?.duration || 1.0;
        const t = Math.round(norm * dur * 1000) / 1000;
        this.editor.seek(t);
        this._updatePlayheadVisuals();
    }

    _updatePlayButton() {
        const btnPlay = this.container.querySelector('#btn-play');
        if (btnPlay) {
            btnPlay.textContent = this.editor.isPlaying ? '⏸' : '▶';
            btnPlay.title = this.editor.isPlaying ? 'Pause (Space)' : 'Play (Space)';
        }
    }

    _updatePlayheadVisuals() {
        const playhead = this.container.querySelector('#playhead-line');
        const readout = this.container.querySelector('#time-readout');
        const dur = this.editor.clip?.duration || 1.0;
        const t = this.editor.playheadTime || 0;
        const pct = Math.min(100, Math.max(0, (t / dur) * 100));

        if (playhead) playhead.style.left = `${pct}%`;
        if (readout) readout.textContent = `${t.toFixed(2)}s`;
        this._updatePlayButton();
    }

    _renderRuler() {
        const marksEl = this.container.querySelector('#ruler-marks');
        if (!marksEl) return;
        const dur = this.editor.clip?.duration || 2.0;

        // Choose step based on duration
        const step = dur <= 2.0 ? 0.2 : (dur <= 5.0 ? 0.5 : (dur <= 10.0 ? 1.0 : 2.0));
        let html = '';
        for (let t = 0; t <= dur + 0.001; t += step) {
            const pct = (t / dur) * 100;
            html += `
                <div class="ruler-tick" style="left: ${pct}%;">
                    <div class="tick-line"></div>
                    <span class="tick-label">${t.toFixed(1)}s</span>
                </div>
            `;
        }
        marksEl.innerHTML = html;
    }

    _renderTracks() {
        const labelsList = this.container.querySelector('#track-labels-list');
        const tracksList = this.container.querySelector('#bone-tracks-list');
        const summaryTrack = this.container.querySelector('#summary-track');
        if (!labelsList || !tracksList || !summaryTrack) return;

        const clip = this.editor.clip;
        const dur = clip?.duration || 2.0;
        const tracks = clip?.tracks || {};
        const boneNames = Object.keys(tracks).sort();

        // 1. Summary Track (all unique timestamps across all tracks)
        const allTimes = new Set();
        Object.values(tracks).forEach(keys => keys.forEach(k => allTimes.add(k.t)));
        const sortedTimes = [...allTimes].sort((a, b) => a - b);

        let summaryHtml = '';
        for (const t of sortedTimes) {
            const pct = (t / dur) * 100;
            summaryHtml += `
                <div class="diamond summary-diamond" style="left: ${pct}%;" data-time="${t}" title="Summary Key at ${t.toFixed(2)}s"></div>
            `;
        }
        summaryTrack.innerHTML = summaryHtml;

        // 2. Per-Bone Tracks
        let labelsHtml = '';
        let tracksHtml = '';

        for (const boneName of boneNames) {
            const keyframes = tracks[boneName] || [];
            const isSelectedBone = this.editor.selectedBones?.has(boneName);

            labelsHtml += `
                <div class="label-row ${isSelectedBone ? 'selected-bone' : ''}" data-bone="${boneName}" title="${boneName} (${keyframes.length} keys)">
                    <span class="label-text">${boneName}</span>
                    <span class="key-count">${keyframes.length}</span>
                </div>
            `;

            let diamondsHtml = '';
            keyframes.forEach((key, idx) => {
                const pct = (key.t / dur) * 100;
                const isSelected = this.selectedKey?.boneName === boneName && this.selectedKey?.index === idx;
                diamondsHtml += `
                    <div class="diamond ${isSelected ? 'active' : ''} interp-${key.interp || 'smooth'}"
                         style="left: ${pct}%;"
                         data-bone="${boneName}"
                         data-idx="${idx}"
                         data-time="${key.t}"
                         title="${boneName} key at ${key.t.toFixed(2)}s (${key.interp || 'smooth'})">
                    </div>
                `;
            });

            tracksHtml += `
                <div class="track-row ${isSelectedBone ? 'selected-bone' : ''}" data-bone="${boneName}">
                    ${diamondsHtml}
                </div>
            `;
        }

        labelsList.innerHTML = labelsHtml || '<div class="no-tracks-hint">No keyed tracks yet. Select bones and press I.</div>';
        tracksList.innerHTML = tracksHtml;

        this._bindTrackEvents();
    }

    _bindTrackEvents() {
        const root = this.container;

        // Label clicks select the bone
        root.querySelectorAll('.dopesheet-labels-col .label-row[data-bone]').forEach(row => {
            row.addEventListener('click', (e) => {
                const boneName = row.dataset.bone;
                this.editor.selectedBones.clear();
                this.editor.selectedBones.add(boneName);
                this.editor.skeletonOverlay?.selectBone(boneName, false);
                this.refresh();
                this.onUpdate?.();
            });
        });

        // Summary diamond click seeks to that timestamp
        root.querySelectorAll('.summary-diamond').forEach(dia => {
            dia.addEventListener('click', (e) => {
                e.stopPropagation();
                const t = parseFloat(dia.dataset.time);
                if (!isNaN(t)) {
                    this.editor.seek(t);
                    this.refresh();
                }
            });
        });

        // Diamond click & drag to retime!
        root.querySelectorAll('.bone-tracks-list .diamond').forEach(dia => {
            dia.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                const boneName = dia.dataset.bone;
                const index = parseInt(dia.dataset.idx, 10);
                const t = parseFloat(dia.dataset.time);

                this.selectedKey = { boneName, index, t };
                this.editor.seek(t);
                this._updateSelectedKeyInspector();
                this._renderTracks();

                // Start dragging key to retime
                this._dragKey = {
                    boneName,
                    index,
                    startT: t,
                    startClientX: e.clientX,
                };

                const timelineCol = this.container.querySelector('#timeline-scroll-area');
                const colRect = timelineCol.getBoundingClientRect();
                const dur = this.editor.clip.duration || 1.0;

                const onPointerMove = (ev) => {
                    if (!this._dragKey) return;
                    const deltaX = ev.clientX - this._dragKey.startClientX;
                    const deltaT = (deltaX / colRect.width) * dur;
                    let newT = Math.max(0, Math.min(dur, this._dragKey.startT + deltaT));
                    newT = Math.round(newT * 100) / 100; // snap to 0.01s

                    const track = this.editor.clip.tracks[this._dragKey.boneName];
                    if (track && track[this._dragKey.index]) {
                        track[this._dragKey.index].t = newT;
                        this.selectedKey.t = newT;
                        this.editor.seek(newT);
                        this._updatePlayheadVisuals();
                        // Update diamond position visually during drag
                        const pct = (newT / dur) * 100;
                        dia.style.left = `${pct}%`;
                        dia.title = `${this._dragKey.boneName} key at ${newT.toFixed(2)}s`;
                    }
                };

                const onPointerUp = () => {
                    if (this._dragKey) {
                        const track = this.editor.clip.tracks[this._dragKey.boneName];
                        if (track) track.sort((a, b) => a.t - b.t);
                        this._dragKey = null;
                        this.refresh();
                        this.onUpdate?.();
                    }
                    window.removeEventListener('pointermove', onPointerMove);
                    window.removeEventListener('pointerup', onPointerUp);
                };

                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', onPointerUp);
            });
        });
    }

    _updateSelectedKeyInspector() {
        const emptyEl = this.container.querySelector('#inspector-empty');
        const contentEl = this.container.querySelector('#inspector-content');
        if (!this.selectedKey || !this.editor.clip) {
            if (emptyEl) emptyEl.style.display = 'block';
            if (contentEl) contentEl.style.display = 'none';
            return;
        }

        const { boneName, index } = this.selectedKey;
        const track = this.editor.clip.tracks[boneName];
        if (!track || !track[index]) {
            this.selectedKey = null;
            if (emptyEl) emptyEl.style.display = 'block';
            if (contentEl) contentEl.style.display = 'none';
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'flex';

        const key = track[index];
        const nextKey = track[index + 1];

        const lbl = this.container.querySelector('#inspector-bone-label');
        if (lbl) lbl.textContent = `Bone: ${boneName} [Key #${index + 1}]`;

        const timeInp = this.container.querySelector('#insp-time-input');
        if (timeInp) timeInp.value = key.t.toFixed(2);

        const gapInp = this.container.querySelector('#insp-gap-input');
        if (gapInp) {
            if (nextKey) {
                gapInp.value = (nextKey.t - key.t).toFixed(2);
                gapInp.disabled = false;
            } else {
                gapInp.value = '';
                gapInp.placeholder = 'End';
                gapInp.disabled = true;
            }
        }

        const interpSel = this.container.querySelector('#insp-interp-select');
        if (interpSel) interpSel.value = key.interp || 'smooth';
    }

    _adjustKeyDelta(delta) {
        if (!this.selectedKey || !this.editor.clip) return;
        const { boneName, index, t: curT } = this.selectedKey;
        const track = this.editor.clip.tracks[boneName];
        if (!track || index >= track.length - 1) return; // Need a next key to adjust gap

        const nextKey = track[index + 1];
        const syncAll = !!this.container.querySelector('#chk-sync-all-tracks')?.checked;
        const dur = this.editor.clip.duration || 1.0;

        if (syncAll) {
            // Find all keys at or near nextKey.t across all tracks and shift them
            const targetNextT = nextKey.t;
            const newNextT = Math.max(curT + 0.05, Math.round((targetNextT + delta) * 100) / 100);
            const actualDelta = newNextT - targetNextT;
            if (Math.abs(actualDelta) < 0.001) return;

            for (const tr of Object.values(this.editor.clip.tracks)) {
                for (const k of tr) {
                    if (k.t >= targetNextT - 0.02) {
                        k.t = Math.round((k.t + actualDelta) * 100) / 100;
                        if (k.t > this.editor.clip.duration) {
                            this.editor.clip.duration = Math.round((k.t + 0.2) * 10) / 10;
                        }
                    }
                }
                tr.sort((a, b) => a.t - b.t);
            }
        } else {
            let newNextT = Math.max(track[index].t + 0.05, Math.min(dur + 10.0, nextKey.t + delta));
            newNextT = Math.round(newNextT * 100) / 100;
            const actualDelta = newNextT - nextKey.t;

            nextKey.t = newNextT;
            for (let i = index + 2; i < track.length; i++) {
                if (track[i].t <= track[i - 1].t) {
                    track[i].t = Math.round((track[i - 1].t + 0.05) * 100) / 100;
                }
            }
            if (newNextT > this.editor.clip.duration) {
                this.editor.clip.duration = Math.round((newNextT + 0.2) * 10) / 10;
            }
        }

        const durInp = this.container.querySelector('#inp-duration');
        if (durInp) durInp.value = this.editor.clip.duration;

        this.refresh();
        this.onUpdate?.();
    }
}
