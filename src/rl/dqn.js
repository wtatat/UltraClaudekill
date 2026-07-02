import { MLP } from './net.js';

// Plain DQN: epsilon-greedy, uniform replay, target network, Huber-clipped TD.
export class DQN {
  constructor({ obsDim, nActions, hidden = [64, 64], lr = 1e-3, gamma = 0.99,
                bufferSize = 30000, batchSize = 64, warmup = 1000,
                targetSync = 800, epsStart = 1.0, epsEnd = 0.05, epsDecaySteps = 30000 }) {
    this.obsDim = obsDim;
    this.nActions = nActions;
    this.net = new MLP([obsDim, ...hidden, nActions]);
    this.target = new MLP([obsDim, ...hidden, nActions]);
    this.target.copyFrom(this.net);
    this.lr = lr;
    this.gamma = gamma;
    this.batchSize = batchSize;
    this.warmup = warmup;
    this.targetSync = targetSync;
    this.epsStart = epsStart;
    this.epsEnd = epsEnd;
    this.epsDecaySteps = epsDecaySteps;
    this.steps = 0;
    this.trainSteps = 0;
    this.lastLoss = 0;
    // ring-buffer replay
    this.cap = bufferSize;
    this.size = 0;
    this.head = 0;
    this.obs = new Float32Array(bufferSize * obsDim);
    this.nextObs = new Float32Array(bufferSize * obsDim);
    this.actions = new Uint8Array(bufferSize);
    this.rewards = new Float32Array(bufferSize);
    this.dones = new Uint8Array(bufferSize);
  }

  get epsilon() {
    const t = Math.min(1, this.steps / this.epsDecaySteps);
    return this.epsStart + (this.epsEnd - this.epsStart) * t;
  }

  act(obs, greedy = false) {
    if (!greedy && Math.random() < this.epsilon) {
      return Math.floor(Math.random() * this.nActions);
    }
    const q = this.net.forward(obs);
    let best = 0;
    for (let a = 1; a < this.nActions; a++) if (q[a] > q[best]) best = a;
    return best;
  }

  remember(obs, action, reward, nextObs, done) {
    const i = this.head;
    this.obs.set(obs, i * this.obsDim);
    this.nextObs.set(nextObs, i * this.obsDim);
    this.actions[i] = action;
    this.rewards[i] = reward;
    this.dones[i] = done ? 1 : 0;
    this.head = (this.head + 1) % this.cap;
    this.size = Math.min(this.size + 1, this.cap);
    this.steps++;
  }

  trainStep() {
    if (this.size < Math.max(this.warmup, this.batchSize)) return 0;
    const grads = this.net.zeroGrads();
    let lossSum = 0;
    for (let n = 0; n < this.batchSize; n++) {
      const i = Math.floor(Math.random() * this.size);
      const o = this.obs.subarray(i * this.obsDim, (i + 1) * this.obsDim);
      const o2 = this.nextObs.subarray(i * this.obsDim, (i + 1) * this.obsDim);
      const a = this.actions[i];
      let y = this.rewards[i];
      if (!this.dones[i]) {
        const qNext = this.target.forward(o2);
        let m = qNext[0];
        for (let k = 1; k < this.nActions; k++) if (qNext[k] > m) m = qNext[k];
        y += this.gamma * m;
      }
      const cache = {};
      const q = this.net.forward(o, cache);
      let td = q[a] - y;
      lossSum += 0.5 * td * td;
      // Huber: clip the gradient of the TD error
      if (td > 1) td = 1; else if (td < -1) td = -1;
      const dOut = new Float32Array(this.nActions);
      dOut[a] = td;
      this.net.backward(cache, dOut, grads);
    }
    this.net.adamStep(grads, this.lr, this.batchSize);
    this.trainSteps++;
    if (this.trainSteps % this.targetSync === 0) this.target.copyFrom(this.net);
    this.lastLoss = lossSum / this.batchSize;
    return this.lastLoss;
  }

  save() {
    return JSON.stringify({ net: this.net.toJSON(), steps: this.steps, trainSteps: this.trainSteps });
  }

  load(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    this.net = MLP.fromJSON(data.net);
    this.target = MLP.fromJSON(data.net);
    this.steps = data.steps || this.epsDecaySteps; // treat loaded nets as past exploration
    this.trainSteps = data.trainSteps || 0;
  }
}
