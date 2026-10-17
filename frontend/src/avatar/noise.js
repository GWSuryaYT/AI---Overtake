// ═══════════════════════════════════════════════════
//  2D Simplex Noise — pure, no dependencies, ~60 lines
//  Based on Stefan Gustavson's simplex noise algorithm
// ═══════════════════════════════════════════════════

// Permutation table (seeded, deterministic)
const _p = new Uint8Array(512);
const _grad = [
    [1,1],[-1,1],[1,-1],[-1,-1],
    [1,0],[-1,0],[0,1],[0,-1],
];

let _seeded = false;

function _seed(s) {
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    // Fisher-Yates with simple hash
    for (let i = 255; i > 0; i--) {
        s = (s * 16807 + 0) % 2147483647;
        const j = s % (i + 1);
        const tmp = perm[i];
        perm[i] = perm[j];
        perm[j] = tmp;
    }
    for (let i = 0; i < 512; i++) _p[i] = perm[i & 255];
    _seeded = true;
}

function _dot2(gi, x, y) {
    const g = _grad[gi & 7];
    return g[0] * x + g[1] * y;
}

const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

/**
 * 2D Simplex noise. Returns value in [-1, 1].
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function simplex2(x, y) {
    if (!_seeded) _seed(42);

    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);

    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n0 = 0, n1 = 0, n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
        t0 *= t0;
        n0 = t0 * t0 * _dot2(_p[ii + _p[jj]], x0, y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
        t1 *= t1;
        n1 = t1 * t1 * _dot2(_p[ii + i1 + _p[jj + j1]], x1, y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
        t2 *= t2;
        n2 = t2 * t2 * _dot2(_p[ii + 1 + _p[jj + 1]], x2, y2);
    }

    return 70.0 * (n0 + n1 + n2);
}

/**
 * Seed the noise generator.
 * @param {number} seed - integer seed
 */
export function noiseSeed(seed) {
    _seed(seed | 0);
}

/**
 * Fractal Brownian Motion (layered noise).
 * @param {number} x
 * @param {number} y
 * @param {number} octaves
 * @param {number} lacunarity - frequency multiplier per octave (default 2)
 * @param {number} gain - amplitude multiplier per octave (default 0.5)
 * @returns {number} value in roughly [-1, 1]
 */
export function fbm(x, y, octaves = 3, lacunarity = 2.0, gain = 0.5) {
    let sum = 0;
    let amp = 1.0;
    let freq = 1.0;
    let maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
        sum += amp * simplex2(x * freq, y * freq);
        maxAmp += amp;
        amp *= gain;
        freq *= lacunarity;
    }
    return sum / maxAmp;
}
