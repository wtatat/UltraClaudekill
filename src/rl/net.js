// Tiny dependency-free MLP with Adam, just enough for DQN-sized nets.
// Layout: input -> ReLU(h1) -> ReLU(h2) -> linear(out)

export class MLP {
  constructor(sizes) {
    this.sizes = sizes;
    this.W = [];
    this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const fanIn = sizes[l], fanOut = sizes[l + 1];
      const scale = Math.sqrt(2 / fanIn);
      const w = new Float32Array(fanIn * fanOut);
      for (let i = 0; i < w.length; i++) w[i] = (Math.random() * 2 - 1) * scale;
      this.W.push(w);
      this.b.push(new Float32Array(fanOut));
    }
    // Adam state
    this.mW = this.W.map(w => new Float32Array(w.length));
    this.vW = this.W.map(w => new Float32Array(w.length));
    this.mB = this.b.map(b => new Float32Array(b.length));
    this.vB = this.b.map(b => new Float32Array(b.length));
    this.t = 0;
  }

  forward(x, cache = null) {
    let a = x;
    if (cache) cache.acts = [x];
    for (let l = 0; l < this.W.length; l++) {
      const fanIn = this.sizes[l], fanOut = this.sizes[l + 1];
      const W = this.W[l], b = this.b[l];
      const out = new Float32Array(fanOut);
      for (let j = 0; j < fanOut; j++) {
        let s = b[j];
        const off = j * fanIn;
        for (let i = 0; i < fanIn; i++) s += W[off + i] * a[i];
        out[j] = (l < this.W.length - 1 && s < 0) ? 0 : s; // ReLU except last
      }
      a = out;
      if (cache) cache.acts.push(a);
    }
    return a;
  }

  // Backprop for a single sample given dLoss/dOut, accumulate into grads.
  backward(cache, dOut, grads) {
    let delta = dOut;
    for (let l = this.W.length - 1; l >= 0; l--) {
      const fanIn = this.sizes[l], fanOut = this.sizes[l + 1];
      const aIn = cache.acts[l];
      const gW = grads.W[l], gB = grads.b[l];
      const newDelta = new Float32Array(fanIn);
      for (let j = 0; j < fanOut; j++) {
        const d = delta[j];
        if (d === 0) continue;
        gB[j] += d;
        const off = j * fanIn;
        for (let i = 0; i < fanIn; i++) {
          gW[off + i] += d * aIn[i];
          newDelta[i] += d * this.W[l][off + i];
        }
      }
      if (l > 0) {
        const aOut = cache.acts[l]; // post-ReLU activations of layer l
        for (let i = 0; i < fanIn; i++) if (aOut[i] <= 0) newDelta[i] = 0;
      }
      delta = newDelta;
    }
  }

  zeroGrads() {
    return {
      W: this.W.map(w => new Float32Array(w.length)),
      b: this.b.map(b => new Float32Array(b.length)),
    };
  }

  adamStep(grads, lr, batchSize) {
    this.t++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    for (let l = 0; l < this.W.length; l++) {
      const W = this.W[l], gW = grads.W[l], mW = this.mW[l], vW = this.vW[l];
      for (let i = 0; i < W.length; i++) {
        const g = gW[i] / batchSize;
        mW[i] = b1 * mW[i] + (1 - b1) * g;
        vW[i] = b2 * vW[i] + (1 - b2) * g * g;
        W[i] -= lr * (mW[i] / c1) / (Math.sqrt(vW[i] / c2) + eps);
      }
      const B = this.b[l], gB = grads.b[l], mB = this.mB[l], vB = this.vB[l];
      for (let i = 0; i < B.length; i++) {
        const g = gB[i] / batchSize;
        mB[i] = b1 * mB[i] + (1 - b1) * g;
        vB[i] = b2 * vB[i] + (1 - b2) * g * g;
        B[i] -= lr * (mB[i] / c1) / (Math.sqrt(vB[i] / c2) + eps);
      }
    }
  }

  copyFrom(other) {
    for (let l = 0; l < this.W.length; l++) {
      this.W[l].set(other.W[l]);
      this.b[l].set(other.b[l]);
    }
  }

  toJSON() {
    return {
      sizes: this.sizes,
      W: this.W.map(w => Array.from(w)),
      b: this.b.map(b => Array.from(b)),
    };
  }

  static fromJSON(data) {
    const net = new MLP(data.sizes);
    data.W.forEach((w, l) => net.W[l].set(w));
    data.b.forEach((b, l) => net.b[l].set(b));
    return net;
  }
}
