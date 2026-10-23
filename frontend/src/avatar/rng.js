// ═══════════════════════════════════════════════════
//  RNG — Deterministic Injectable Seeded PRNG (Mulberry32)
//  Replaces Math.random() across avatar/* for full reproducibility
// ═══════════════════════════════════════════════════

export class PRNG {
    /**
     * @param {number} [seed=12345]
     */
    constructor(seed = 12345) {
        this._initialSeed = seed;
        this._state = seed >>> 0;
    }

    /**
     * Re-seed the generator.
     * @param {number} s
     */
    seed(s) {
        this._initialSeed = s;
        this._state = (s === 0 ? 1 : s) >>> 0;
    }

    /**
     * Reset to initial seed.
     */
    reset() {
        this.seed(this._initialSeed);
    }

    /**
     * Returns a pseudorandom float in [0, 1).
     * @returns {number}
     */
    next() {
        let t = (this._state += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /**
     * Return float in [min, max).
     */
    range(min, max) {
        return min + this.next() * (max - min);
    }

    /**
     * Return integer in [min, max] inclusive.
     */
    int(min, max) {
        return Math.floor(this.range(min, max + 1));
    }

    /**
     * Return normally distributed float with Box-Muller transform.
     */
    gaussian(mean = 0, std = 1) {
        let u1 = this.next();
        let u2 = this.next();
        while (u1 <= 1e-7) u1 = this.next();
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        return mean + z0 * std;
    }

    /**
     * Pick random item from array.
     */
    choice(arr) {
        if (!arr || arr.length === 0) return null;
        return arr[Math.floor(this.next() * arr.length)];
    }
}

export const SeededRNG = PRNG;

// Global default instance for the avatar engine
export const defaultRNG = new PRNG(1337);
export const avatarRNG = defaultRNG;

export function seed(s) {
    defaultRNG.seed(s);
}

export function random() {
    return defaultRNG.next();
}

export function randomRange(min, max) {
    return defaultRNG.range(min, max);
}

export function randomInt(min, max) {
    return defaultRNG.int(min, max);
}

export function randomGaussian(mean, std) {
    return defaultRNG.gaussian(mean, std);
}

export function randomChoice(arr) {
    return defaultRNG.choice(arr);
}
