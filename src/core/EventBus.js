// Minimal synchronous publish/subscribe bus shared by every system.
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    this.handlers.get(type)?.delete(fn);
  }
  emit(type, payload) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] handler for "${type}" failed`, err);
      }
    }
  }
  clear() {
    this.handlers.clear();
  }
}

export const bus = new EventBus();
