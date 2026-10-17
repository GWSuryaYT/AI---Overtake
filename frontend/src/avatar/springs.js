// ═══════════════════════════════════════════════════
//  Critically Damped Spring — frame-rate independent
//  Pure math, no Three.js dependency, unit-testable.
//
//  Uses the exact formula: x(t) = target + (x0 - target + v0*t) * e^(-ω*t)
//  Simplified as exponential smoothing: 1 - exp(-k * dt)
// ═══════════════════════════════════════════════════

/**
 * Compute the exponential smoothing factor for frame-rate independent lerp.
 * Use as: current += (target - current) * smoothFactor(speed, dt)
 * @param {number} speed - spring speed (higher = faster convergence). Roughly 1/halflife.
 * @param {number} dt - delta time in seconds
 * @returns {number} factor in [0, 1]
 */
export function smoothFactor(speed, dt) {
    return 1.0 - Math.exp(-speed * dt);
}

/**
 * A single-value critically damped spring.
 * Tracks a target with smooth, overshoot-free motion.
 */
export class Spring {
    /**
     * @param {number} initial - starting value
     * @param {number} speed - convergence speed (higher = faster). ~8-15 for snappy, ~3-5 for slow.
     */
    constructor(initial = 0, speed = 10) {
        this.value = initial;
        this.target = initial;
        this.velocity = 0;
        this.speed = speed;
    }

    /**
     * Advance the spring by dt seconds.
     * @param {number} dt
     * @returns {number} the new value
     */
    update(dt) {
        const f = smoothFactor(this.speed, dt);
        this.value += (this.target - this.value) * f;
        return this.value;
    }

    /**
     * Snap to target immediately (no animation).
     * @param {number} val
     */
    snap(val) {
        this.value = val;
        this.target = val;
        this.velocity = 0;
    }
}

/**
 * A spring that tracks a value with velocity (second-order critically damped).
 * Better for things that need momentum (head motion, arm targets).
 *
 * Uses the closed-form critically damped solution:
 *   ω = speed
 *   x(t) = target + (Δx + (Δv + ω·Δx)·t) · e^(−ω·t)
 * For discrete steps we approximate with the half-step method.
 */
export class DampedSpring {
    constructor(initial = 0, speed = 10) {
        this.value = initial;
        this.target = initial;
        this.velocity = 0;
        this.speed = speed;
    }

    update(dt) {
        const omega = this.speed;
        const exp = Math.exp(-omega * dt);
        const dx = this.value - this.target;
        const dv = this.velocity + omega * dx;

        this.value = this.target + (dx + dv * dt) * exp;
        this.velocity = (this.velocity - omega * dv * dt) * exp;
        return this.value;
    }

    snap(val) {
        this.value = val;
        this.target = val;
        this.velocity = 0;
    }
}

/**
 * A 3-component spring (e.g., for Vector3-like objects).
 * Operates on plain {x, y, z} objects — no Three.js dependency.
 */
export class Spring3 {
    constructor(x = 0, y = 0, z = 0, speed = 10) {
        this.value = { x, y, z };
        this.target = { x, y, z };
        this.speed = speed;
    }

    update(dt) {
        const f = smoothFactor(this.speed, dt);
        this.value.x += (this.target.x - this.value.x) * f;
        this.value.y += (this.target.y - this.value.y) * f;
        this.value.z += (this.target.z - this.value.z) * f;
        return this.value;
    }

    setTarget(x, y, z) {
        this.target.x = x;
        this.target.y = y;
        this.target.z = z;
    }

    snap(x, y, z) {
        this.value.x = this.target.x = x;
        this.value.y = this.target.y = y;
        this.value.z = this.target.z = z;
    }
}
