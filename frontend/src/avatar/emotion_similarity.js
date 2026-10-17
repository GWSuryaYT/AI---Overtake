// ═══════════════════════════════════════════════════
//  EMOTION SIMILARITY & DISTINCTNESS AUDITOR
//  Computes multi-dimensional metric across expression blends,
//  head orientation, and gaze targets.
// ═══════════════════════════════════════════════════

/**
 * Compute the distance between two emotion configurations.
 * Metric incorporates:
 * 1. Expression blend vector Euclidean distance (weight: 1.0)
 * 2. Head orientation pitch/yaw/roll Euclidean distance (weight: 1.5)
 * 3. Gaze target discrepancy (weight: 0.4)
 * 4. Arousal & Valence discrepancy (weight: 0.5)
 *
 * @param {object} e1 - First emotion config
 * @param {object} e2 - Second emotion config
 * @returns {number} Distance (higher = more distinct, lower = more similar)
 */
export function computeEmotionDistance(e1, e2) {
    if (!e1 || !e2) return 999;

    // 1. Expression vector distance
    const allExprKeys = new Set([
        ...Object.keys(e1.expressions || {}),
        ...Object.keys(e2.expressions || {})
    ]);

    let exprDistSq = 0;
    for (const k of allExprKeys) {
        const w1 = e1.expressions?.[k] || 0;
        const w2 = e2.expressions?.[k] || 0;
        const diff = w1 - w2;
        exprDistSq += diff * diff;
    }
    const dExpr = Math.sqrt(exprDistSq);

    // 2. Head pose distance (radians)
    const h1 = e1.headOffset || { pitch: 0, yaw: 0, roll: 0 };
    const h2 = e2.headOffset || { pitch: 0, yaw: 0, roll: 0 };
    const dPitch = (h1.pitch || 0) - (h2.pitch || 0);
    const dYaw = (h1.yaw || 0) - (h2.yaw || 0);
    const dRoll = (h1.roll || 0) - (h2.roll || 0);
    const dHead = Math.sqrt(dPitch * dPitch + dYaw * dYaw + dRoll * dRoll);

    // 3. Gaze distance
    const dGaze = (e1.gaze === e2.gaze) ? 0 : 0.35;

    // 4. Arousal & valence distance
    const dArousal = (e1.arousal ?? 0.5) - (e2.arousal ?? 0.5);
    const dValence = (e1.valence ?? 0.0) - (e2.valence ?? 0.0);
    const dCircumplex = Math.sqrt(dArousal * dArousal + dValence * dValence);

    return Math.round((dExpr * 1.0 + dHead * 2.0 + dGaze + dCircumplex * 0.4) * 1000) / 1000;
}

/**
 * Scan an entire emotion map and find all pairs that are below the distinctness threshold.
 *
 * @param {object} emotionMap - Dict of emotion configs
 * @param {number} [threshold=0.35] - Minimum required distance
 * @returns {Array<{ emoA: string, emoB: string, distance: number }>} Flagged pairs
 */
export function findSimilarEmotionPairs(emotionMap, threshold = 0.35) {
    const keys = Object.keys(emotionMap || {});
    const flagged = [];

    for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
            const a = keys[i];
            const b = keys[j];
            const dist = computeEmotionDistance(emotionMap[a], emotionMap[b]);
            if (dist < threshold) {
                flagged.push({
                    emoA: a,
                    emoB: b,
                    distance: dist
                });
            }
        }
    }

    flagged.sort((a, b) => a.distance - b.distance);
    return flagged;
}

/**
 * Find the closest neighbor for a specific emotion.
 * @param {string} emotionName
 * @param {object} emotionMap
 * @returns {{ neighbor: string, distance: number }}
 */
export function getClosestNeighbor(emotionName, emotionMap) {
    const target = emotionMap[emotionName];
    if (!target) return { neighbor: null, distance: 999 };

    let minDist = 999;
    let closest = null;

    for (const [name, cfg] of Object.entries(emotionMap)) {
        if (name === emotionName) continue;
        const dist = computeEmotionDistance(target, cfg);
        if (dist < minDist) {
            minDist = dist;
            closest = name;
        }
    }

    return { neighbor: closest, distance: minDist };
}
