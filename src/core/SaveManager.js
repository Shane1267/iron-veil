// Versioned single-player saves in IndexedDB (falls back to localStorage if IndexedDB
// is unavailable). Each write keeps the previous copy as a backup that is used if the
// main record fails validation.

export const SAVE_VERSION = 1;
const DB_NAME = 'ironveil';
const STORE = 'saves';
export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'];

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'slot' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Structural validation of a save record. Returns an error string or null. */
export function validateSave(rec) {
  if (!rec || typeof rec !== 'object') return 'Not an object';
  if (rec.version !== SAVE_VERSION) return `Unsupported version ${rec.version}`;
  const d = rec.data;
  if (!d || typeof d !== 'object') return 'Missing data';
  const p = d.player;
  if (!p || !p.pos || ![p.pos.x, p.pos.y, p.pos.z].every(Number.isFinite)) return 'Invalid player position';
  if (!p.equipment || typeof p.equipment !== 'object') return 'Invalid equipment';
  if (!d.world || !Number.isFinite(d.world.clock?.gameMinutes)) return 'Invalid world clock';
  if (d.base && !Array.isArray(d.base.pieces)) return 'Invalid base data';
  if (d.loot && typeof d.loot !== 'object') return 'Invalid container data';
  return null;
}

export class SaveManager {
  constructor() {
    this.dbPromise = null;
    this.mode = 'indexeddb';
    this.busy = false;
  }

  async _db() {
    if (!this.dbPromise) {
      this.dbPromise = openDB().catch((e) => {
        console.warn('[Save] IndexedDB unavailable, using localStorage fallback', e);
        this.mode = 'local';
        return null;
      });
    }
    return this.dbPromise;
  }

  async _put(rec) {
    const db = await this._db();
    if (!db) {
      localStorage.setItem(`ironveil.save.${rec.slot}`, JSON.stringify(rec));
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async _get(slot) {
    const db = await this._db();
    if (!db) {
      const raw = localStorage.getItem(`ironveil.save.${slot}`);
      return raw ? JSON.parse(raw) : null;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(slot);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async _delete(slot) {
    const db = await this._db();
    if (!db) { localStorage.removeItem(`ironveil.save.${slot}`); return; }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(slot);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Save game data to a slot. The previous record becomes the slot's backup. */
  async save(slot, data, summary) {
    if (this.busy) return { ok: false, msg: 'A save is already in progress' };
    this.busy = true;
    try {
      const rec = { slot, version: SAVE_VERSION, timestamp: Date.now(), summary, data };
      const err = validateSave(rec);
      if (err) throw new Error(`Refusing to write invalid save: ${err}`);
      // structured-clone safety: strip functions/undefined
      const clean = JSON.parse(JSON.stringify(rec));
      const prev = await this._get(slot).catch(() => null);
      if (prev && !validateSave(prev)) await this._put({ ...prev, slot: `${slot}.bak` });
      await this._put(clean);
      return { ok: true };
    } catch (e) {
      console.error('[Save] failed', e);
      return { ok: false, msg: String(e.message || e) };
    } finally {
      this.busy = false;
    }
  }

  /** Load a slot; falls back to its backup when the main record is corrupt. */
  async load(slot) {
    let rec = await this._get(slot).catch(() => null);
    let err = validateSave(rec);
    if (err) {
      const bak = await this._get(`${slot}.bak`).catch(() => null);
      const berr = validateSave(bak);
      if (!berr) return { ok: true, rec: { ...bak, slot }, recovered: true };
      return { ok: false, msg: rec ? `Save is corrupt (${err})` : 'No save in this slot' };
    }
    return { ok: true, rec };
  }

  async list() {
    const out = [];
    for (const slot of SLOTS) {
      const rec = await this._get(slot).catch(() => null);
      if (rec) out.push({ slot, timestamp: rec.timestamp, summary: rec.summary, valid: !validateSave(rec) });
    }
    return out;
  }

  async latest() {
    const l = (await this.list()).filter((s) => s.valid);
    l.sort((a, b) => b.timestamp - a.timestamp);
    return l[0] || null;
  }

  async remove(slot) {
    await this._delete(slot);
    await this._delete(`${slot}.bak`).catch(() => {});
  }
}

export const saves = new SaveManager();
