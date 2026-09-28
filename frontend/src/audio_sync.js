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

export function initAudioSync() {
    connectWebSocket();

    // Unlock AudioContext on first user gesture
    const unlock = () => { if (!isAudioInitialized) initAudioContext(); };
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
    };

    ws.onmessage = async (event) => {
        if (typeof event.data === 'string') {
            const msg = event.data;

            if (msg === '[DONE]') {
                console.log('[WS] LLM response complete.');
                if (!isPlaying) {
                    _onResponseComplete();
                }
                return;
            }
            if (msg === '[STT_OK]') {
                setAnimationState('thinking');
                return;
            }
            if (msg === '[SPEAKING]') {
                setAnimationState('speaking');
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
//  MICROPHONE
// ═══════════════════════════════════════════════════
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let currentStream = null;
let isKeyboardSetup = false;

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
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = [];
            if (blob.size > 0) {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    const buf = await blob.arrayBuffer();
                    console.log(`[STT] Sending ${buf.byteLength} bytes`);
                    setAnimationState('thinking');
                    ws.send(buf);
                } else {
                    console.warn('⚠️ [STT] WebSocket not open! Attempting connection...', ws ? ws.readyState : 'no ws');
                    setAnimationState('idle');
                    connectWebSocket();
                }
            } else {
                setAnimationState('idle');
            }
        };

        if (!isKeyboardSetup) {
            isKeyboardSetup = true;

            const stopRecording = () => {
                if (!isRecording) return;
                isRecording = false;
                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    try {
                        mediaRecorder.stop();
                        console.log('🎙️ Stopped recording.');
                    } catch (err) {
                        console.error('Error stopping MediaRecorder:', err);
                    }
                }
            };

            window.addEventListener('keydown', (e) => {
                if ((e.code === 'Space' || e.key === ' ') && !e.repeat) {
                    if (document.activeElement && document.activeElement !== document.body) {
                        document.activeElement.blur();
                    }
                    if (!isRecording && mediaRecorder && mediaRecorder.state === 'inactive') {
                        e.preventDefault();
                        isRecording = true;
                        audioChunks = [];
                        mediaRecorder.start();
                        setAnimationState('listening');
                        console.log('🎙️ Recording…');
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
