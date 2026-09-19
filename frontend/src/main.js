import './style.css';
import { initVRM }                    from './renderer.js';
import { initAudioSync, setupMicrophone } from './audio_sync.js';

document.addEventListener('DOMContentLoaded', () => {
    initVRM();
    initAudioSync();
    setupMicrophone();

    // ── Mic bar collapse/expand toggle ──
    const micControls = document.getElementById('mic-controls');
    const micToggle   = document.getElementById('micToggle');

    if (micToggle && micControls) {
        micToggle.addEventListener('click', () => {
            const collapsed = micControls.classList.toggle('collapsed');
            micToggle.textContent = collapsed ? '+' : '−';
            micToggle.title       = collapsed ? 'Show mic controls' : 'Hide mic controls';
        });
    }
});
