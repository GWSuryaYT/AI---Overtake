// ═══════════════════════════════════════════════════
//  STUDIO VALIDATOR — Gesture Program & Library Validator
//  Ensures data integrity, valid ranges, and known presets.
//  Flags semantic mistakes (such as the legacy shy y:+0.48 pos).
// ═══════════════════════════════════════════════════

export const KNOWN_PALMS = ['inward', 'forward', 'up', 'down', 'outward'];
export const KNOWN_POLES = ['elbow_down', 'elbow_out', 'elbow_in', 'elbow_up_out'];
export const KNOWN_SHAPES = ['soft_open', 'open', 'relaxed', 'point', 'chin_rest', 'cup', 'fist', 'pinch'];
export const KNOWN_LEADS = ['dominant', 'either', 'both', 'left', 'right'];

/**
 * Validate a single gesture program definition.
 * @param {string} name - gesture name
 * @param {object} program - gesture program definition
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateGestureProgram(name, program) {
    const errors = [];
    const warnings = [];

    if (!program || typeof program !== 'object') {
        return { valid: false, errors: [`Program '${name}' must be an object`], warnings: [] };
    }

    if (!Array.isArray(program.keys) || program.keys.length === 0) {
        errors.push(`Program '${name}' must have at least one keyframe in 'keys'`);
    } else {
        program.keys.forEach((key, idx) => {
            if (!key || typeof key !== 'object') {
                errors.push(`Program '${name}' key [${idx}] is not an object`);
                return;
            }

            // Validate timing t
            if (!Array.isArray(key.t) || key.t.length < 2) {
                errors.push(`Program '${name}' key [${idx}] requires t: [min, max]`);
            } else {
                if (typeof key.t[0] !== 'number' || typeof key.t[1] !== 'number' || isNaN(key.t[0]) || isNaN(key.t[1])) {
                    errors.push(`Program '${name}' key [${idx}] t values must be numbers`);
                } else if (key.t[0] > key.t[1]) {
                    errors.push(`Program '${name}' key [${idx}] t[0] (${key.t[0]}) must be <= t[1] (${key.t[1]})`);
                } else if (key.t[0] <= 0 || key.t[1] <= 0) {
                    errors.push(`Program '${name}' key [${idx}] durations must be positive`);
                }
            }

            // Validate position pos
            if (!Array.isArray(key.pos) || key.pos.length < 3) {
                errors.push(`Program '${name}' key [${idx}] requires pos: [x, y, z]`);
            } else {
                for (let axis = 0; axis < 3; axis++) {
                    if (typeof key.pos[axis] !== 'number' || isNaN(key.pos[axis])) {
                        errors.push(`Program '${name}' key [${idx}] pos[${axis}] must be a valid number`);
                    }
                }
            }

            // Validate palm
            if (key.palm && !KNOWN_PALMS.includes(key.palm)) {
                warnings.push(`Program '${name}' key [${idx}] uses uncommon palm '${key.palm}'`);
            }

            // Validate shape
            if (key.shape && !KNOWN_SHAPES.includes(key.shape)) {
                warnings.push(`Program '${name}' key [${idx}] uses uncommon hand shape '${key.shape}'`);
            }

            // Validate pole override
            if (key.pole && !KNOWN_POLES.includes(key.pole)) {
                warnings.push(`Program '${name}' key [${idx}] uses unknown pole preset '${key.pole}'`);
            }

            // Validate shoulderLift
            if (key.shoulderLift !== undefined) {
                if (typeof key.shoulderLift !== 'number' || isNaN(key.shoulderLift)) {
                    errors.push(`Program '${name}' key [${idx}] shoulderLift must be a number`);
                } else if (key.shoulderLift < -0.3 || key.shoulderLift > 0.5) {
                    warnings.push(`Program '${name}' key [${idx}] shoulderLift (${key.shoulderLift}) is unusually extreme`);
                }
            }
        });
    }

    // Program level pole
    if (program.pole && !KNOWN_POLES.includes(program.pole)) {
        warnings.push(`Program '${name}' pole preset '${program.pole}' is unknown`);
    }

    // Program level lead
    if (program.lead && !KNOWN_LEADS.includes(program.lead)) {
        warnings.push(`Program '${name}' lead '${program.lead}' is unknown`);
    }

    // Validate oscillator if present
    if (program.oscillate) {
        const osc = program.oscillate;
        if (!osc.cycles || !Array.isArray(osc.cycles) || osc.cycles[0] > osc.cycles[1]) {
            errors.push(`Program '${name}' oscillator requires cycles: [min, max] where min <= max`);
        }
        if (!osc.freq || !Array.isArray(osc.freq) || osc.freq[0] > osc.freq[1]) {
            errors.push(`Program '${name}' oscillator requires freq: [min, max] where min <= max`);
        }
        if (!osc.ampDeg || !Array.isArray(osc.ampDeg) || osc.ampDeg[0] > osc.ampDeg[1]) {
            errors.push(`Program '${name}' oscillator requires ampDeg: [min, max] where min <= max`);
        }
    }

    // Specific anomaly flag: shy pos y is near chin (+0.48) instead of belly
    if (name === 'shy' && program.keys && program.keys[0]?.pos?.[1] > 0.2) {
        warnings.push(`Gesture 'shy' pos.y = +${program.keys[0].pos[1]} puts hands near chin/head height instead of belly (expected ~ -0.90). Check if intended.`);
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validate an entire gesture library payload.
 * @param {object} payload - { GESTURE_LIBRARY, GESTURE_MODES }
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateGestureLibrary(payload) {
    const errors = [];
    const warnings = [];

    if (!payload || typeof payload !== 'object') {
        return { valid: false, errors: ['Invalid payload: must be an object'], warnings: [] };
    }

    const lib = payload.GESTURE_LIBRARY || payload;
    if (typeof lib !== 'object') {
        return { valid: false, errors: ['GESTURE_LIBRARY must be an object'], warnings: [] };
    }

    for (const [name, prog] of Object.entries(lib)) {
        const res = validateGestureProgram(name, prog);
        if (!res.valid) {
            errors.push(...res.errors);
        }
        if (res.warnings.length > 0) {
            warnings.push(...res.warnings);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}
