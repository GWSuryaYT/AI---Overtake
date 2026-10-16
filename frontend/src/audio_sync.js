import { setAnimationState, setLipSyncPhonemes } from './renderer.js';

let audioContext;
let analyser;
let source;
let ws;
let isAudioInitialized = false;

// Audio queue so sentences don't cut each other off
const audioQueue = [];
let isPlaying    = false;



let reconnectTimer = null;
let isHandsFree = localStorage.getItem('handsFreeMode') === 'true';
let isLastRecordingFromVad = false;
let isVadRecording = false;
let discardCurrentRecording = false;
let micAudioContext = null;
let micAnalyser = null;
let micSource = null;
let vadInterval = null;
let speechStartTime = 0;
let lastSpeechTime = 0;

export function getHandsFreeMode() {
    return isHandsFree;
}

export function updateHandsFreeStatus(text) {
    const statusEl = document.getElementById('handsFreeStatus');
    const textEl = document.getElementById('handsFreeStatusText');
    if (!statusEl || !textEl) return;

    if (!isHandsFree || !text) {
        statusEl.classList.add('hidden');
    } else {
        statusEl.classList.remove('hidden');
        textEl.textContent = text;
    }
}

export function setHandsFreeMode(enabled) {
    isHandsFree = enabled;
    localStorage.setItem('handsFreeMode', enabled ? 'true' : 'false');
    updateHandsFreeStatus(enabled ? 'Listening for "Anna"…' : '');
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify({ type: 'set_hands_free', enabled }));
        } catch (e) {}
    }

    if (enabled) {
        startVadLoop();
    } else {
        stopVadLoop();
    }
}

export function initAudioSync() {
    connectWebSocket();

    // Unlock AudioContext on first user gesture
    const unlock = () => { 
        if (!isAudioInitialized) initAudioContext();
        if (micAudioContext && micAudioContext.state === 'suspended') {
            micAudioContext.resume();
        }
    };
    document.addEventListener('click',   unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
}

function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return;
    }

    console.log('[WS] Connecting to ws://127.0.0.1:8000/ws ...');
    ws = new WebSocket('ws://127.0.0.1:8000/ws');
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        console.log('✅ [WS] WebSocket connected.');
        if (reconnectTimer) {
            clearInterval(reconnectTimer);
            reconnectTimer = null;
        }
        if (isHandsFree) {
            try {
                ws.send(JSON.stringify({ type: 'set_hands_free', enabled: true }));
            } catch (e) {}
        }
        updateHandsFreeStatus(isHandsFree ? 'Listening for "Anna"…' : '');
    };

    ws.onmessage = async (event) => {
        if (typeof event.data === 'string') {
            const msg = event.data;

            if (msg === '[DONE]') {
                console.log('[WS] LLM response complete.');
                if (!isPlaying) {
                    _onResponseComplete();
                }
                updateHandsFreeStatus(isHandsFree ? 'Listening for "Anna"…' : '');
                return;
            }
            if (msg === '[STT_OK]') {
                setAnimationState('thinking');
                updateHandsFreeStatus('Anna is thinking…');
                return;
            }
            if (msg === '[SPEAKING]') {
                setAnimationState('speaking');
                updateHandsFreeStatus('Anna is speaking…');
                return;
            }
            return;
        }

        // Binary → WAV audio chunk
        if (!isAudioInitialized) initAudioContext();

        try {
            const copy = event.data.slice(0);
            const audioBuffer = await audioContext.decodeAudioData(copy);

            audioQueue.push(audioBuffer);
            if (!isPlaying) {
                setAnimationState('speaking');
                playNext();
            }
        } catch (e) {
            console.error('Error decoding audio:', e);
        }
    };

    ws.onclose = () => {
        console.warn('⚠️ [WS] WebSocket disconnected or unavailable. Will retry...');
        scheduleReconnect();
    };

    ws.onerror = (e) => {
        console.error('⚠️ [WS] WebSocket error:', e);
        ws.close();
    };
}

function scheduleReconnect() {
    if (!reconnectTimer) {
        reconnectTimer = setInterval(() => {
            console.log('[WS] Attempting reconnection...');
            connectWebSocket();
        }, 2000);
    }
}

function initAudioContext() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.connect(audioContext.destination);
    isAudioInitialized = true;
    console.log('AudioContext initialized.');
    analyzeVolume();
}

function playNext() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        _onResponseComplete();
        return;
    }

    isPlaying = true;
    const buffer = audioQueue.shift();

    source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    source.onended = () => playNext();
    source.start(0);
}

function _onResponseComplete() {
    setAnimationState('idle');
}

// ── Phoneme analysis (frequency-band heuristic) ──
function analyzeVolume() {
    requestAnimationFrame(analyzeVolume);
    if (!isAudioInitialized || !analyser) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    let sum = 0, lowSum = 0, midSum = 0, highSum = 0;

    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
        if      (i <= 5)  lowSum  += dataArray[i];
        else if (i <= 16) midSum  += dataArray[i];
        else if (i <= 32) highSum += dataArray[i];
    }

    const volume  = Math.min(1.0, (sum / dataArray.length) / 128.0);
    const l       = Math.min(1.0, (lowSum  / 6)  / 255.0);
    const m       = Math.min(1.0, (midSum  / 11) / 255.0);
    const h       = Math.min(1.0, (highSum / 16) / 255.0);

    let a = 0, e = 0, i = 0, o = 0, u = 0;

    if (volume > 0.02) {
        const openAmount = Math.min(0.75, volume * 1.8);

        if (l > m && l > h * 1.5) {
            // Low-dominant: rounded (O/U)
            o = openAmount * 0.9;
            u = openAmount * 0.4;
        } else if (h > m * 1.2) {
            // High-dominant: wide (E/I)
            e = openAmount * 0.8;
            i = openAmount * 0.5;
        } else {
            // Balanced / mid: open (A)
            a = openAmount;
        }
    }

    setLipSyncPhonemes({ a, e, i, o, u });
}

// ═══════════════════════════════════════════════════
//  MICROPHONE & HANDS-FREE VAD
// ═══════════════════════════════════════════════════
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let currentStream = null;
let isKeyboardSetup = false;

function startVadLoop() {
    if (vadInterval) return;
    vadInterval = setInterval(checkVad, 40);
    console.log('🎙️ [VAD] Hands-free listener started.');
}

function stopVadLoop() {
    if (vadInterval) {
        clearInterval(vadInterval);
        vadInterval = null;
    }
    if (isVadRecording) {
        cancelVadRecording();
    }
    console.log('🎙️ [VAD] Hands-free listener stopped.');
}

function cancelVadRecording() {
    if (!isVadRecording) return;
    isVadRecording = false;
    discardCurrentRecording = true;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try {
            mediaRecorder.stop();
        } catch (e) {}
    }
    audioChunks = [];
    setAnimationState('idle');
    updateHandsFreeStatus(isHandsFree ? 'Listening for "Anna"…' : '');
}

function checkVad() {
    if (!isHandsFree) return;
    if (!micAnalyser) return;
    if (!mediaRecorder) return;
    
    // Do not record while user is manually pressing Spacebar
    if (isRecording) return;
    
    // Do not record while Anna is speaking or thinking (prevents echo/loop)
    if (isPlaying) {
        if (isVadRecording) cancelVadRecording();
        return;
    }

    const bufferLength = micAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    micAnalyser.getByteFrequencyData(dataArray);

    // Sum voice frequency bands (bins 2 through 64)
    let sum = 0;
    const startBin = 2;
    const endBin = Math.min(bufferLength, 64);
    for (let i = startBin; i < endBin; i++) {
        sum += dataArray[i];
    }
    const avgVolume = sum / (endBin - startBin) / 255.0; // 0.0 to 1.0

    const now = Date.now();
    const SPEECH_START_THRESHOLD = 0.055;
    const SPEECH_CONTINUE_THRESHOLD = 0.035;
    const SILENCE_TIMEOUT = 950;       // ms of silence before ending utterance
    const MIN_SPEECH_DURATION = 550;   // ms minimum speech duration to be valid
    const MAX_SPEECH_DURATION = 15000;  // ms maximum speech duration

    if (!isVadRecording) {
        if (avgVolume > SPEECH_START_THRESHOLD && mediaRecorder.state === 'inactive') {
            isVadRecording = true;
            discardCurrentRecording = false;
            speechStartTime = now;
            lastSpeechTime = now;
            audioChunks = [];
            try {
                mediaRecorder.start();
                setAnimationState('listening');
                updateHandsFreeStatus('Hearing voice…');
                console.log('🎙️ [VAD] Speech detected. Recording…');
            } catch (e) {
                console.error('Error starting MediaRecorder in VAD:', e);
                isVadRecording = false;
            }
        }
    } else {
        if (avgVolume > SPEECH_CONTINUE_THRESHOLD) {
            lastSpeechTime = now;
        }

        const recordingDuration = now - speechStartTime;
        const silenceDuration = now - lastSpeechTime;

        if (silenceDuration > SILENCE_TIMEOUT || recordingDuration > MAX_SPEECH_DURATION) {
            if (recordingDuration >= MIN_SPEECH_DURATION) {
                console.log(`🎙️ [VAD] Speech finished (${recordingDuration}ms). Processing…`);
                isVadRecording = false;
                isLastRecordingFromVad = true;
                updateHandsFreeStatus('Processing…');
                try {
                    mediaRecorder.stop();
                } catch (e) {
                    console.error('Error stopping MediaRecorder in VAD:', e);
                }
            } else {
                // Short noise/click -> cancel
                cancelVadRecording();
            }
        }
    }
}

async function enumerateMicrophones() {
    try {
        const devices    = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        const select     = document.getElementById('micSelect');
        if (!select) return;

        const currentValue = select.value;
        select.innerHTML   = '';

        audioInputs.forEach((device, idx) => {
            const option  = document.createElement('option');
            option.value  = device.deviceId;
            option.text   = device.label || `Microphone ${idx + 1}`;
            select.appendChild(option);
        });

        if (currentValue && audioInputs.some(d => d.deviceId === currentValue)) {
            select.value = currentValue;
        }
    } catch (e) {
        console.error('enumerateMicrophones error:', e);
    }
}

export async function setupMicrophone(deviceId = null) {
    try {
        if (currentStream) currentStream.getTracks().forEach(t => t.stop());

        const constraints = {
            audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
        };
        if (deviceId) constraints.audio.deviceId = { exact: deviceId };

        const stream  = await navigator.mediaDevices.getUserMedia(constraints);
        currentStream = stream;

        // Connect mic stream to analyser for VAD
        try {
            if (!micAudioContext) {
                micAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (micSource) {
                micSource.disconnect();
            }
            micSource = micAudioContext.createMediaStreamSource(stream);
            micAnalyser = micAudioContext.createAnalyser();
            micAnalyser.fftSize = 512;
            micSource.connect(micAnalyser);
        } catch (err) {
            console.error('Error setting up mic analyser for VAD:', err);
        }

        await enumerateMicrophones();

        const select = document.getElementById('micSelect');
        if (select && !select.hasAttribute('data-initialized')) {
            select.setAttribute('data-initialized', 'true');
            select.addEventListener('change', (e) => setupMicrophone(e.target.value));
        }

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            if (discardCurrentRecording) {
                discardCurrentRecording = false;
                audioChunks = [];
                isVadRecording = false;
                setAnimationState('idle');
                updateHandsFreeStatus(isHandsFree ? 'Listening for "Anna"…' : '');
                return;
            }

            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = [];
            const wasVad = isLastRecordingFromVad;
            isLastRecordingFromVad = false;
            isVadRecording = false;

            if (blob.size > 0) {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    const buf = await blob.arrayBuffer();
                    console.log(`[STT] Sending ${buf.byteLength} bytes (handsFree=${wasVad})`);
                    setAnimationState('thinking');
                    updateHandsFreeStatus('Anna is thinking…');
                    try {
                        ws.send(JSON.stringify({ type: 'audio_meta', hands_free: wasVad }));
                    } catch (e) {}
                    ws.send(buf);
                } else {
                    console.warn('⚠️ [STT] WebSocket not open! Attempting connection...', ws ? ws.readyState : 'no ws');
                    setAnimationState('idle');
                    updateHandsFreeStatus(isHandsFree ? 'Listening for "Anna"…' : '');
                    connectWebSocket();
                }
            } else {
                setAnimationState('idle');
                updateHandsFreeStatus(isHandsFree ? 'Listening for "Anna"…' : '');
            }
        };

        if (isHandsFree) {
            startVadLoop();
        }

        if (!isKeyboardSetup) {
            isKeyboardSetup = true;

            const stopRecording = () => {
                if (!isRecording) return;
                isRecording = false;
                isLastRecordingFromVad = false;
                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    try {
                        mediaRecorder.stop();
                        console.log('🎙️ Stopped manual recording.');
                    } catch (err) {
                        console.error('Error stopping MediaRecorder:', err);
                    }
                }
            };

            window.addEventListener('keydown', (e) => {
                if ((e.code === 'Space' || e.key === ' ') && !e.repeat) {
                    const tag = document.activeElement ? document.activeElement.tagName : '';
                    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
                        return;
                    }
                    if (document.activeElement && document.activeElement !== document.body) {
                        document.activeElement.blur();
                    }
                    if (isVadRecording) {
                        cancelVadRecording();
                    }
                    if (!isRecording && mediaRecorder && mediaRecorder.state === 'inactive') {
                        e.preventDefault();
                        isRecording = true;
                        isLastRecordingFromVad = false;
                        audioChunks = [];
                        mediaRecorder.start();
                        setAnimationState('listening');
                        updateHandsFreeStatus('Listening (Spacebar)…');
                        console.log('🎙️ Manual recording started…');
                    }
                }
            });

            window.addEventListener('keyup', (e) => {
                if (e.code === 'Space' || e.key === ' ') {
                    if (isRecording) {
                        e.preventDefault();
                        stopRecording();
                    }
                }
            });

            window.addEventListener('blur', () => {
                stopRecording();
            });
        }
    } catch (e) {
        console.error('Microphone error:', e);
    }
}
