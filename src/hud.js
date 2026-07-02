// DOM-based HUD: health, stamina, style meter, boss bar, messages.

const RANKS = [
  { letter: 'D', name: 'DRAB', color: '#7a7a7a', need: 0 },
  { letter: 'C', name: 'CRUEL', color: '#4da6ff', need: 90 },
  { letter: 'B', name: 'BLOODY', color: '#4dff88', need: 220 },
  { letter: 'A', name: 'ATROCIOUS', color: '#ffe14d', need: 400 },
  { letter: 'S', name: 'SAVAGE', color: '#ff9a3d', need: 650 },
  { letter: 'SS', name: 'SSEVERE', color: '#ff5533', need: 950 },
  { letter: 'SSS', name: 'SSSANGUINE', color: '#ff2255', need: 1300 },
  { letter: 'U', name: 'ULTRACLAUDEKILL', color: '#ff00aa', need: 1750 },
];

class StyleMeter {
  constructor(G) {
    this.G = G;
    this.points = 0;
    this.total = 0;
    this.rank = 0;
    this.lastGain = 0;
    this.killTimes = [];
  }

  add(pts, label) {
    this.points += pts;
    this.total += pts;
    this.lastGain = 0;
    if (label) this.G.hud.styleEvent('+ ' + label);
    while (this.rank < RANKS.length - 1 && this.points >= RANKS[this.rank + 1].need) {
      this.rank++;
      this.G.audio.rankUp(this.rank);
    }
  }

  kill(pts, name) {
    const now = performance.now() / 1000;
    this.killTimes = this.killTimes.filter(t => now - t < 2);
    this.killTimes.push(now);
    this.add(pts, name + ' SLAIN');
    if (this.killTimes.length === 2) this.add(50, 'DOUBLE KILL');
    else if (this.killTimes.length === 3) this.add(80, 'TRIPLE KILL');
    else if (this.killTimes.length >= 4) this.add(120, 'RAMPAGE');
  }

  varietyBonus(weapon) {
    if (this._lastWeapon && this._lastWeapon !== weapon) this.add(15, null);
    this._lastWeapon = weapon;
  }

  hurt() {
    this.points = Math.max(0, this.points - 60);
    while (this.rank > 0 && this.points < RANKS[this.rank].need) this.rank--;
  }

  update(dt) {
    this.lastGain += dt;
    if (this.lastGain > 1.2 && this.points > 0) {
      this.points = Math.max(0, this.points - (14 + this.rank * 12) * dt);
      while (this.rank > 0 && this.points < RANKS[this.rank].need) this.rank--;
    }
  }

  frac() {
    const cur = RANKS[this.rank].need;
    const next = this.rank < RANKS.length - 1 ? RANKS[this.rank + 1].need : cur + 400;
    return Math.min(1, (this.points - cur) / (next - cur));
  }
}

export class Hud {
  constructor(G) {
    this.G = G;
    this.style = new StyleMeter(G);
    this.el = {
      hp: document.getElementById('hp-fill'),
      hpNum: document.getElementById('hp-num'),
      stamina: [...document.querySelectorAll('.stam-bar')],
      rankLetter: document.getElementById('rank-letter'),
      rankName: document.getElementById('rank-name'),
      rankFill: document.getElementById('rank-fill'),
      styleBox: document.getElementById('style-box'),
      events: document.getElementById('style-events'),
      weapon: document.getElementById('weapon-name'),
      msg: document.getElementById('center-msg'),
      hitmarker: document.getElementById('hitmarker'),
      vignette: document.getElementById('damage-vignette'),
      boss: document.getElementById('boss-bar'),
      bossFill: document.getElementById('boss-fill'),
      bossName: document.getElementById('boss-name'),
      objective: document.getElementById('objective'),
      charge: document.getElementById('charge-fill'),
      chargeBox: document.getElementById('charge-box'),
    };
    this._msgT = null;
  }

  setWeapon(name) {
    this.el.weapon.textContent = name === 'revolver' ? 'PIERCER REVOLVER' : 'PUMP SHOTGUN';
    this.el.chargeBox.style.display = name === 'revolver' ? 'block' : 'none';
  }

  setObjective(text) {
    this.el.objective.textContent = text;
  }

  message(text, ms = 2600) {
    this.el.msg.textContent = text;
    this.el.msg.style.opacity = 1;
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => { this.el.msg.style.opacity = 0; }, ms);
  }

  styleEvent(text) {
    const div = document.createElement('div');
    div.textContent = text;
    this.el.events.prepend(div);
    while (this.el.events.children.length > 7) this.el.events.lastChild.remove();
    setTimeout(() => { div.style.opacity = 0; }, 1400);
    setTimeout(() => div.remove(), 2000);
  }

  hitmarker() {
    this.el.hitmarker.classList.remove('show');
    void this.el.hitmarker.offsetWidth;
    this.el.hitmarker.classList.add('show');
  }

  damageFlash() {
    this.el.vignette.classList.remove('show');
    void this.el.vignette.offsetWidth;
    this.el.vignette.classList.add('show');
  }

  bossBar(frac, name) {
    this.el.boss.style.display = name ? 'block' : 'none';
    if (name) {
      this.el.bossName.textContent = name;
      this.el.bossFill.style.width = (frac * 100) + '%';
    }
  }

  update(dt) {
    const P = this.G.player;
    this.style.update(dt);
    const hpFrac = Math.max(0, P.hp / P.maxHp);
    this.el.hp.style.width = (hpFrac * 100) + '%';
    this.el.hp.style.background = hpFrac > 0.5 ? '#e33' : (hpFrac > 0.25 ? '#f80' : '#f00');
    this.el.hpNum.textContent = Math.ceil(P.hp);
    document.body.classList.toggle('low-hp', hpFrac <= 0.3 && !P.dead);
    for (let i = 0; i < this.el.stamina.length; i++) {
      const f = Math.min(1, Math.max(0, P.stamina - i));
      this.el.stamina[i].style.setProperty('--f', f);
      this.el.stamina[i].classList.toggle('full', f >= 1);
    }
    const r = RANKS[this.style.rank];
    const active = this.style.points > 0;
    this.el.styleBox.style.opacity = active ? 1 : 0.25;
    this.el.rankLetter.textContent = r.letter;
    this.el.rankLetter.style.color = r.color;
    this.el.rankName.textContent = r.name;
    this.el.rankName.style.color = r.color;
    this.el.rankFill.style.width = (this.style.frac() * 100) + '%';
    this.el.rankFill.style.background = r.color;
    // charge indicator
    const W = this.G.weapons;
    if (W.current === 'revolver') {
      const f = W.charging ? W.charge : (W.chargeCd > 0 ? 1 - W.chargeCd / 3 : 1);
      this.el.charge.style.width = (f * 100) + '%';
      this.el.charge.style.background = (W.chargeCd <= 0 || W.charging) ? '#39c2ff' : '#245';
    }
  }
}

export { RANKS };
