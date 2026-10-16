import './style.css';
import { initVRM }                                              from './renderer.js';
import { initAudioSync, setupMicrophone, setHandsFreeMode, getHandsFreeMode } from './audio_sync.js';

document.addEventListener('DOMContentLoaded', () => {
    initVRM();
    initAudioSync();
    setupMicrophone();

    // ── Settings UI elements ──
    const settingsContainer = document.getElementById('settings-container');
    const settingsBtn       = document.getElementById('settingsBtn');
    const settingsPanel     = document.getElementById('settingsPanel');
    const closeSettingsBtn  = document.getElementById('closeSettingsBtn');
    const handsFreeToggle   = document.getElementById('handsFreeToggle');

    // Prevent dragging window when clicking inside settings
    if (settingsContainer) {
        settingsContainer.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
    }

    // Toggle Settings panel open/close
    if (settingsBtn && settingsPanel) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = settingsPanel.classList.toggle('hidden');
            settingsBtn.classList.toggle('active', !isHidden);
        });
    }

    if (closeSettingsBtn && settingsPanel && settingsBtn) {
        closeSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsPanel.classList.add('hidden');
            settingsBtn.classList.remove('active');
        });
    }

    // Close panel if clicked outside
    document.addEventListener('click', (e) => {
        if (settingsContainer && !settingsContainer.contains(e.target)) {
            if (settingsPanel && !settingsPanel.classList.contains('hidden')) {
                settingsPanel.classList.add('hidden');
                if (settingsBtn) settingsBtn.classList.remove('active');
            }
        }
    });

    // ── Hands-Free Toggle ──
    if (handsFreeToggle) {
        // Load initial state
        handsFreeToggle.checked = getHandsFreeMode();

        handsFreeToggle.addEventListener('change', (e) => {
            setHandsFreeMode(e.target.checked);
        });
    }
});
