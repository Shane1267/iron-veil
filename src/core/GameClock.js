// World time. One in-game day lasts `dayLengthMinutes` real minutes (default 60).
export class GameClock {
  constructor() {
    this.gameMinutes = 7.5 * 60; // day 1, 07:30
    this.dayLengthMinutes = 60;
    this.paused = false;
  }
  get scale() {
    return (24 * 60) / (this.dayLengthMinutes * 60); // game minutes per real second
  }
  update(dt) {
    if (!this.paused) this.gameMinutes += dt * this.scale;
  }
  get hours() {
    return (this.gameMinutes / 60) % 24;
  }
  get day() {
    return Math.floor(this.gameMinutes / (24 * 60)) + 1;
  }
  get label() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  serialize() { return { gameMinutes: this.gameMinutes }; }
  deserialize(o) { if (Number.isFinite(o?.gameMinutes)) this.gameMinutes = Math.max(0, o.gameMinutes); }
}
