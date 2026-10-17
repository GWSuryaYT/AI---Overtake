import emotionData from './emotion_map.json';

export let EMOTIONS = { ...emotionData };

export function setEmotions(newMap) {
    EMOTIONS = { ...newMap };
}

export function updateEmotion(name, config) {
    EMOTIONS[name] = { ...config };
}

export function getEmotionConfig(name) {
    if (!name) return EMOTIONS.neutral;
    const config = EMOTIONS[name];
    if (!config) {
        const isDevOrTest = (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') ||
                            (typeof import.meta !== 'undefined' && import.meta?.env?.DEV);
        if (isDevOrTest) {
            throw new Error(`[EmotionMap] Unknown emotion "${name}"`);
        }
        return EMOTIONS.neutral;
    }
    return config;
}

