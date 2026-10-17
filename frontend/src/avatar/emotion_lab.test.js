import { describe, it, expect } from 'vitest';
import emotionData from './emotion_map.json';
import { computeEmotionDistance, findSimilarEmotionPairs, getClosestNeighbor } from './emotion_similarity.js';
import cueVocab from './cue_vocab.json';

describe('Emotion Lab: Distinctness & Auto-Check', () => {
    it('Every canonical LLM emotion is present in emotion_map.json', () => {
        const canonical = cueVocab.emotions || [];
        expect(canonical.length).toBeGreaterThan(0);
        for (const emo of canonical) {
            expect(emotionData[emo], `Emotion '${emo}' must exist in emotion_map.json`).toBeDefined();
        }
    });

    it('All canonical emotions are distinct (distance >= 0.35)', () => {
        const flagged = findSimilarEmotionPairs(emotionData, 0.35);
        if (flagged.length > 0) {
            const desc = flagged.map(f => `${f.emoA} <-> ${f.emoB} (dist: ${f.distance})`).join(', ');
            expect.fail(`The following emotion pairs are too similar: ${desc}`);
        }
        expect(flagged).toHaveLength(0);
    });

    it('computeEmotionDistance detects duplicate or near-identical emotions', () => {
        const e1 = {
            expressions: { happy: 0.8 },
            headOffset: { pitch: -0.05, yaw: 0, roll: 0 },
            gaze: 'user',
            arousal: 0.7,
            valence: 0.8
        };
        const eIdentical = JSON.parse(JSON.stringify(e1));
        expect(computeEmotionDistance(e1, eIdentical)).toBe(0);

        const eNearIdentical = {
            expressions: { happy: 0.82 },
            headOffset: { pitch: -0.05, yaw: 0.01, roll: 0 },
            gaze: 'user',
            arousal: 0.7,
            valence: 0.8
        };
        const dist = computeEmotionDistance(e1, eNearIdentical);
        expect(dist).toBeLessThan(0.1);

        const flagged = findSimilarEmotionPairs({ e1, eNearIdentical }, 0.35);
        expect(flagged).toHaveLength(1);
        expect(flagged[0].emoA).toBe('e1');
        expect(flagged[0].emoB).toBe('eNearIdentical');
    });

    it('getClosestNeighbor finds the most similar neighbor for an emotion', () => {
        const res = getClosestNeighbor('happy', emotionData);
        expect(res.neighbor).not.toBeNull();
        expect(res.distance).toBeGreaterThanOrEqual(0.35);
    });
});
