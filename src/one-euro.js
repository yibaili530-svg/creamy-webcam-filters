// One Euro filter (Casiez et al.). Smooths a scalar stream: heavy smoothing at rest, light smoothing when fast.
// Time is in seconds, values in normalised frame units. minCutoff ~1 Hz at rest; beta raises the cutoff with speed.

function alpha(dt, cutoff) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  constructor({ minCutoff = 1.0, beta = 2.0, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
    this.t = 0;
  }

  filter(t, x) {
    if (this.x === null) {
      this.x = x;
      this.t = t;
      return x;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const aD = alpha(dt, this.dCutoff);
    this.dx = aD * ((x - this.x) / dt) + (1 - aD) * this.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = alpha(dt, cutoff);
    this.x = a * x + (1 - a) * this.x;
    return this.x;
  }
}
