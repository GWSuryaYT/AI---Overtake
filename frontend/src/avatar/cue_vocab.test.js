import { describe, it, expect, vi } from 'vitest';
import cueVocab from './cue_vocab.json';
import { EMOTIONS, getEmotionConfig } from './emotion_map.js';
import { GESTURE_LIBRARY } from './gesture_library.js';
import { GAZE } from './avatar_config.js';
import { CueScheduler } from './cue_scheduler.js';

describe('Cue Vocabulary Parity & Consistency', () => {
    it('loads cue_vocab.json with required canonical categories', () => {
        expect(Array.isArray(cueVocab.emotions)).toBe(true);
        expect(Array.isArray(cueVocab.gestures)).toBe(true);
        expect(Array.isArray(cueVocab.gaze_targets)).toBe(true);
        expect(Array.isArray(cueVocab.internal_gestures)).toBe(true);

        expect(cueVocab.emotions.length).toBe(13);
        expect(cueVocab.gestures.length).toBe(10);
        expect(cueVocab.gaze_targets.length).toBe(6);
    });

    it('consistency test: every emotion in vocab resolves to emotion_map', () => {
        for (const emo of cueVocab.emotions) {
            expect(EMOTIONS[emo], `Emotion "${emo}" must exist in EMOTIONS`).toBeDefined();
            const config = getEmotionConfig(emo);
            expect(config).toBeDefined();
            expect(config.expressions).toBeDefined();
            expect(config.headOffset).toBeDefined();
        }
    });

    it('consistency test: every gesture in vocab resolves to gesture_library or is none', () => {
        for (const gest of cueVocab.gestures) {
            if (gest === 'none') continue;
            expect(GESTURE_LIBRARY[gest], `Gesture "${gest}" must exist in GESTURE_LIBRARY`).toBeDefined();
        }
    });

    it('consistency test: internal gestures resolve to gesture_library', () => {
        for (const gest of cueVocab.internal_gestures) {
            expect(GESTURE_LIBRARY[gest], `Internal gesture "${gest}" must exist in GESTURE_LIBRARY`).toBeDefined();
        }
    });

    it('consistency test: every gaze target in vocab resolves to GAZE.TARGETS or user', () => {
        for (const gaze of cueVocab.gaze_targets) {
            const isKnown = gaze === 'user' || !!GAZE.TARGETS[gaze];
            expect(isKnown, `Gaze target "${gaze}" must exist in GAZE.TARGETS or be user`).toBe(true);
        }
    });

    it('throws in dev/test when unknown emotion is requested', () => {
        expect(() => getEmotionConfig('totally_fake_emotion')).toThrow(/Unknown emotion/);
    });
});

describe('Director Cue Application & Error Enforcement', () => {
    function createMockDirector() {
        return {
            emotion: 'neutral',
            emotionIntensity: 0,
            gestureMode: 'none',
            gazeTarget: 'user',
            appliedCues: [],
            applyCue(cue) {
                if (!cue) return;
                if (cue.emotion) {
                    if (!EMOTIONS[cue.emotion]) {
                        throw new Error(`[Director] Unknown emotion: "${cue.emotion}"`);
                    }
                    this.emotion = cue.emotion;
                    this.emotionIntensity = cue.intensity || 1.0;
                }
                if (cue.gesture) {
                    const isKnown = cue.gesture === 'none' || !!GESTURE_LIBRARY[cue.gesture];
                    if (!isKnown) {
                        throw new Error(`[Director] Unknown gesture: "${cue.gesture}"`);
                    }
                    this.gestureMode = cue.gesture;
                }
                if (cue.gaze) {
                    const isKnown = cue.gaze === 'user' || !!GAZE.TARGETS[cue.gaze];
                    if (!isKnown) {
                        throw new Error(`[Director] Unknown gaze target: "${cue.gaze}"`);
                    }
                    this.gazeTarget = cue.gaze;
                }
                this.appliedCues.push(cue);
            }
        };
    }

    it('throws in dev/test on unknown cues in director.applyCue', () => {
        const director = createMockDirector();
        expect(() => director.applyCue({ emotion: 'unknown_emotion' })).toThrow(/Unknown emotion/);
        expect(() => director.applyCue({ gesture: 'unknown_gesture' })).toThrow(/Unknown gesture/);
        expect(() => director.applyCue({ gaze: 'unknown_gaze' })).toThrow(/Unknown gaze target/);
    });

    it('applies every canonical vocab value exactly once via cue_scheduler pipeline', () => {
        const director = createMockDirector();
        const scheduler = new CueScheduler({
            onCue: (cue) => director.applyCue(cue)
        });

        // Queue a cue frame for every canonical emotion
        for (const emo of cueVocab.emotions) {
            scheduler.receiveCue({ type: 'cue', emotion: emo, intensity: 0.8 });
        }
        // Queue a cue frame for every canonical gesture
        for (const gest of cueVocab.gestures) {
            scheduler.receiveCue({ type: 'cue', gesture: gest });
        }
        // Queue a cue frame for every canonical gaze target
        for (const gaze of cueVocab.gaze_targets) {
            scheduler.receiveCue({ type: 'cue', gaze });
        }

        const totalExpected = cueVocab.emotions.length + cueVocab.gestures.length + cueVocab.gaze_targets.length;

        // Simulate audio chunk pairing and trigger playback for first 10
        for (let i = 0; i < 10; i++) {
            const paired = scheduler.pairSynchronously({ chunk: i });
            expect(paired.cue).not.toBeNull();
            scheduler.triggerPlayback(paired.cue);
        }

        // Flush remaining cues (e.g. at [DONE])
        scheduler.flush();

        expect(director.appliedCues.length).toBe(totalExpected);

        // Verify each canonical emotion was applied
        for (const emo of cueVocab.emotions) {
            const found = director.appliedCues.some(c => c.emotion === emo);
            expect(found, `Emotion ${emo} should be applied`).toBe(true);
        }
        // Verify each canonical gesture was applied
        for (const gest of cueVocab.gestures) {
            const found = director.appliedCues.some(c => c.gesture === gest);
            expect(found, `Gesture ${gest} should be applied`).toBe(true);
        }
        // Verify each canonical gaze was applied
        for (const gaze of cueVocab.gaze_targets) {
            const found = director.appliedCues.some(c => c.gaze === gaze);
            expect(found, `Gaze ${gaze} should be applied`).toBe(true);
        }
    });
});
