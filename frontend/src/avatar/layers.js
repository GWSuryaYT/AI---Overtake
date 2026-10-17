// ═══════════════════════════════════════════════════
//  AVATAR LAYERS CONFIGURATION & RUNTIME TOGGLES
// ═══════════════════════════════════════════════════

export const avatarLayers = {
    body: true,
    gaze: true,
    expression: true,
    gesture: true,
    arm: true,
    lipsync: true,
};

export function isLayerEnabled(name) {
    return avatarLayers[name] !== false;
}

export function toggleLayer(name) {
    if (name in avatarLayers) {
        avatarLayers[name] = !avatarLayers[name];
        return avatarLayers[name];
    }
    return false;
}
