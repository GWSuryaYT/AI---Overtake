// ═══════════════════════════════════════════════════
//  AVATAR CONFIG — Central tunable constants (v2)
//  Every parameter in the procedural engine lives here.
// ═══════════════════════════════════════════════════

export const USE_PROCEDURAL_ENGINE = true;

// ── Frame / timing ──
export const MAX_DT = 0.05; // clamp dt to 50ms (20 FPS floor)

// ── Blinking ──
export const BLINK = {
    MIN_INTERVAL: 2.0,        // seconds
    MAX_INTERVAL: 6.0,
    DURATION_CLOSE: 0.06,     // seconds to close
    DURATION_OPEN: 0.12,      // seconds to open
    DOUBLE_BLINK_CHANCE: 0.15,
    DOUBLE_BLINK_GAP: 0.12,
    GAZE_SHIFT_BLINK_CHANCE: 0.4,
};

// ── Gaze ──
export const GAZE = {
    SACCADE_MIN_INTERVAL: 0.4,
    SACCADE_MAX_INTERVAL: 2.5,
    SACCADE_MIN_DEG: 2.0,         // degrees
    SACCADE_MAX_DEG: 8.0,
    MICROSACCADE_DEG: 0.35,       // continuous micro-saccade drift
    HEAD_FOLLOW_WEIGHT: 0.30,     // head follows eyes ~30%
    HEAD_FOLLOW_FACTOR: 0.30,     // alias
    NECK_FOLLOW_FACTOR: 0.15,     // neck follows eyes ~15%
    TRACKING_SPEED: 8.0,          // spring speed for gaze target
    SMOOTH_SPEED: 8.0,            // alias
    SPEAKING_USER_RETURN_CHANCE: 0.75,
    TARGETS: {
        user:     { x: 0.0, y: 0.15, z: 2.0 },
        screen:   { x: 0.25, y: -0.25, z: 1.2 },
        away:     { x: 0.45, y: 0.05, z: 1.2 },
        down:     { x: 0.0, y: -0.40, z: 1.0 },
        up_left:  { x: 0.40, y: 0.35, z: 1.0 },   // +X = avatar left
        up_right: { x: -0.40, y: 0.35, z: 1.0 },  // -X = avatar right
    },
};

// ── Expression springs ──
export const EXPRESSION = {
    SPRING_HALFLIFE: 0.12,          // seconds — how fast expressions track targets
    SPRING_SPEED: 12.0,             // spring speed factor
    DECAY_DELAY: 1.5,               // seconds after speech ends before emotion decays
    DECAY_HALFLIFE: 1.8,            // seconds for emotion to decay smoothly to neutral
    MAX_EXPRESSION_WEIGHT: 1.2,     // cap total expression weight to avoid distortion
    MAX_EXPRESSION_SUM: 1.2,        // alias
    LIPSYNC_SMOOTH_SPEED: 14.0,     // smoothing for lip-sync visemes
};

// ── Body / breathing / posture ──
export const BODY = {
    BREATHE_RATE: 0.25,             // Hz (cycles/sec) — ~15 breaths/min
    BREATH_BASE_RATE: 0.25,         // alias
    BREATH_CHEST_DEG: 1.2,          // degrees of chest pitch on breath
    BREATH_SHOULDER_DEG: 0.8,       // degrees of shoulder lift on breath
    SWAY_PERIOD_MIN: 5.0,           // seconds
    SWAY_PERIOD_MAX: 9.0,
    SWAY_SPEED: 3.0,
    POSTURE_SMOOTH_SPEED: 3.0,      // alias
    HEAD_IDLE_AMPLITUDE_DEG: 2.0,   // degrees head micro motion
    SPEAKING_NOD_DEG: 2.5,          // degrees speech emphasis dip
    LISTENING_NOD_DEG: 3.5,
    LISTENING_NOD_INTERVAL: 3.0,
};

// ── Gesture engine & planner ──
export const GESTURE = {
    ONSET_REFRACTORY: 0.45,         // seconds between onset-triggered gestures
    BASELINE_GESTURE_INTERVAL: 1.8, // fallback gesture rate while speaking (seconds)
    ARM_BLEND_RAMP_DURATION: 0.25,  // seconds to blend arm IK in/out
    RECENCY_HISTORY_SIZE: 6,
    MAX_SAME_TYPE_CONSECUTIVE: 2,
    READY_POSE_WAIT_SEC: 0.8,       // pause duration before easing toward idle
    IDLE_RELEASE_SEC: 3.0,          // silence duration before full release to idle
};

// ── Arm IK ──
export const ARM_IK = {
    ELBOW_MIN_ANGLE_DEG: 35.0,      // interior angle bounds (degrees)
    ELBOW_MAX_ANGLE_DEG: 155.0,
    ELBOW_MIN_ANGLE: 35.0 * Math.PI / 180,
    ELBOW_MAX_ANGLE: 155.0 * Math.PI / 180,
    REACH_MIN_RATIO: 0.55,          // soft reach limiter band [0.55R, 0.93R]
    REACH_MAX_RATIO: 0.93,
    POINT_MAX_RATIO: 0.96,
    TORSO_RADIUS: 0.14,             // meters
    HEAD_RADIUS: 0.12,
    MIN_HAND_DIST: 0.03,            // 3 cm separation
    MIN_CLASP_DIST: 0.01,           // 1 cm for clasping hands
};

// ── Speech features ──
export const SPEECH = {
    RMS_SMOOTH_SPEED: 15.0,
    ONSET_MIN_REFRACTORY: 0.35,     // 350 ms refractory
    ONSET_MAX_REFRACTORY: 0.60,
    ONSET_DB_THRESHOLD: 4.5,        // dB above running baseline to trigger onset
    PAUSE_THRESHOLD_MS: 250,        // ms silence for pause
    SPEAKING_RMS_THRESHOLD: 0.015,
};

// ── Debug ──
export const DEBUG = {
    OVERLAY_KEY: 'F2',
    LOG_MODEL_REPORT: true,
};

/**
 * Validate configuration integrity at startup.
 */
export function validateConfig() {
    const requiredSections = [BLINK, GAZE, EXPRESSION, BODY, GESTURE, ARM_IK, SPEECH, DEBUG];
    for (const sec of requiredSections) {
        if (!sec || typeof sec !== 'object') {
            console.warn('[Config] Corrupted config section:', sec);
        }
    }
}
validateConfig();
