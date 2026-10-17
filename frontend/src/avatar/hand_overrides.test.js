import { describe, it, expect, beforeEach } from 'vitest';
import { ProgramPlayer } from './program_player.js';
import { GestureEngine } from './gesture_engine.js';
import { validateGestureProgram } from './studio_validator.js';

describe('Hands: Left / Right / Both and Overrides', () => {
    const baseProgram = {
        lead: 'dominant',
        pole: 'elbow_down',
        keys: [
            { t: [0.2, 0.3], pos: [0.3, -0.6, 0.7], palm: 'inward', shape: 'soft_open', shoulderLift: 0 },
            { t: [0.2, 0.3], pos: [0.4, -0.5, 0.6], palm: 'up', shape: 'point', shoulderLift: 0.05 }
        ],
        hold: [0.2, 0.4],
        release: 'LIVE_IDLE'
    };

    it('ProgramPlayer evaluates shared keys when no overrides exist', () => {
        const playerRight = new ProgramPlayer(baseProgram, { side: 'right', deterministic: true });
        const playerLeft = new ProgramPlayer(baseProgram, { side: 'left', deterministic: true });

        expect(playerRight.keys.length).toBe(2);
        expect(playerLeft.keys.length).toBe(2);
        expect(playerRight.keys[0].pos).toEqual([0.3, -0.6, 0.7]);
        expect(playerLeft.keys[0].pos).toEqual([0.3, -0.6, 0.7]);

        const poseR = playerRight.evaluate(playerRight.getKeyPeakTime(0));
        const poseL = playerLeft.evaluate(playerLeft.getKeyPeakTime(0));

        // ProgramPlayer returns posU relative to the side
        expect(poseR.posU).toBeDefined();
        expect(poseL.posU).toBeDefined();
    });

    it('ProgramPlayer evaluates per-side overrides independently', () => {
        const progWithOverride = {
            ...baseProgram,
            overrides: {
                left: {
                    keys: [
                        { t: [0.2, 0.3], pos: [0.1, -0.2, 0.3], palm: 'down', shape: 'fist', shoulderLift: 0.1 },
                        { t: [0.2, 0.3], pos: [0.15, -0.25, 0.35], palm: 'down', shape: 'fist', shoulderLift: 0.1 }
                    ]
                }
            }
        };

        const playerRight = new ProgramPlayer(progWithOverride, { side: 'right', deterministic: true });
        const playerLeft = new ProgramPlayer(progWithOverride, { side: 'left', deterministic: true });

        // Right side should still see the shared keys
        expect(playerRight.keys[0].pos).toEqual([0.3, -0.6, 0.7]);
        expect(playerRight.keys[0].palm).toBe('inward');
        expect(playerRight.keys[0].shape).toBe('soft_open');

        // Left side should see the override keys
        expect(playerLeft.keys[0].pos).toEqual([0.1, -0.2, 0.3]);
        expect(playerLeft.keys[0].palm).toBe('down');
        expect(playerLeft.keys[0].shape).toBe('fist');
        expect(playerLeft.keys[0].shoulderLift).toBe(0.1);
    });

    it('GestureEngine sets up dual debug players for "both"', () => {
        const engine = new GestureEngine();
        engine.debug.active = true;

        engine._setupDebugPlayers(baseProgram, 'both', 1.0);

        expect(engine.debug.playerLeft).not.toBeNull();
        expect(engine.debug.playerRight).not.toBeNull();
        expect(engine.debug.playerLeft.side).toBe('left');
        expect(engine.debug.playerRight.side).toBe('right');
    });

    it('GestureEngine sets up left player for "left" and right player for "right"', () => {
        const engine = new GestureEngine();
        engine.debug.active = true;

        engine._setupDebugPlayers(baseProgram, 'left', 1.0);
        expect(engine.debug.playerLeft).not.toBeNull();
        expect(engine.debug.playerRight).toBeNull();
        expect(engine.debug.player.side).toBe('left');

        engine._setupDebugPlayers(baseProgram, 'right', 1.0);
        expect(engine.debug.playerRight).not.toBeNull();
        expect(engine.debug.playerLeft).toBeNull();
        expect(engine.debug.player.side).toBe('right');
    });

    it('GestureEngine _applyDebugPose handles left/right isolation and decay', () => {
        const engine = new GestureEngine();
        engine.debug.active = true;

        // When left is selected, right hand should be set to REST and weight 0
        engine._setupDebugPlayers(baseProgram, 'left', 1.0);
        engine.debug.t = 0.2;
        engine.right.weight = 0.9;
        engine.right.phase = 'STROKE';
        engine._applyDebugPose();

        expect(engine.left.weight).toBeGreaterThan(0);
        expect(engine.right.weight).toBe(0);
        expect(engine.right.phase).toBe('REST');

        // When right is selected, left hand should be set to REST and weight 0
        engine._setupDebugPlayers(baseProgram, 'right', 1.0);
        engine.debug.t = 0.2;
        engine.left.weight = 0.9;
        engine.left.phase = 'STROKE';
        engine._applyDebugPose();

        expect(engine.right.weight).toBeGreaterThan(0);
        expect(engine.left.weight).toBe(0);
        expect(engine.left.phase).toBe('REST');
    });

    it('studio_validator accepts valid overrides and rejects invalid overrides', () => {
        const validProg = {
            ...baseProgram,
            overrides: {
                left: {
                    keys: [
                        { t: [0.2, 0.3], pos: [0.2, -0.4, 0.5], palm: 'inward', shape: 'soft_open' }
                    ]
                }
            }
        };

        const resValid = validateGestureProgram('test_prog', validProg);
        expect(resValid.valid).toBe(true);
        expect(resValid.errors).toHaveLength(0);

        const invalidSideProg = {
            ...baseProgram,
            overrides: {
                invalid_side: {
                    keys: []
                }
            }
        };
        const resInvalidSide = validateGestureProgram('test_prog', invalidSideProg);
        expect(resInvalidSide.valid).toBe(false);
        expect(resInvalidSide.errors.some(e => e.includes('invalid_side'))).toBe(true);

        const invalidKeysProg = {
            ...baseProgram,
            overrides: {
                left: {
                    keys: 'not an array'
                }
            }
        };
        const resInvalidKeys = validateGestureProgram('test_prog', invalidKeysProg);
        expect(resInvalidKeys.valid).toBe(false);
    });

    it('Program JSON with overrides serializes and round-trips losslessly', () => {
        const original = {
            ...baseProgram,
            overrides: {
                left: {
                    keys: [
                        { t: [0.2, 0.3], pos: [0.1, -0.2, 0.3], palm: 'outward', shape: 'pinch_index' }
                    ],
                    pole: 'elbow_out'
                },
                right: {
                    keys: [
                        { t: [0.2, 0.3], pos: [0.5, -0.1, 0.4], palm: 'up', shape: 'open_spread' }
                    ]
                }
            }
        };

        const serialized = JSON.stringify(original, null, 2);
        const parsed = JSON.parse(serialized);

        expect(parsed).toEqual(original);
        expect(parsed.overrides.left.keys[0].pos).toEqual([0.1, -0.2, 0.3]);
        expect(parsed.overrides.left.pole).toBe('elbow_out');
        expect(parsed.overrides.right.keys[0].pos).toEqual([0.5, -0.1, 0.4]);
    });
});
