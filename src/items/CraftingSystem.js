import buildingData from '../data/building.json';
import { ItemDB } from './ItemDatabase.js';

// Recipe-based crafting with tool and station requirements. A crafting job is a timed
// action; inputs are consumed only when the job completes, and only one job can run at
// a time, so held keys or rapid clicks cannot duplicate output.

export const RECIPES = buildingData.recipes;
export const REPAIR = buildingData.repair;

export class CraftingSystem {
  constructor() {
    this.job = null;
  }

  missing(recipe, inv, nearStation) {
    const out = [];
    for (const [id, n] of Object.entries(recipe.in)) {
      const have = inv.count(id);
      if (have < n) out.push(`${ItemDB.get(id)?.name || id} ${have}/${n}`);
    }
    for (const t of recipe.tools || []) if (inv.count(t) < 1) out.push(`Tool: ${ItemDB.get(t)?.name}`);
    if (recipe.station && !nearStation(recipe.station)) out.push('Requires a workbench nearby');
    return out;
  }

  canCraft(recipe, inv, nearStation) {
    return this.missing(recipe, inv, nearStation).length === 0;
  }

  /** Begin crafting. Returns {ok, msg}. */
  start(recipeId, inv, nearStation) {
    if (this.job) return { ok: false, msg: 'Already crafting' };
    const recipe = RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return { ok: false, msg: 'Unknown recipe' };
    const miss = this.missing(recipe, inv, nearStation);
    if (miss.length) return { ok: false, msg: miss.join(', ') };
    this.job = { recipe, t: 0, inv };
    return { ok: true };
  }

  cancel() {
    this.job = null;
  }

  /** Advance the job. Returns {done, ok, msg, progress}. */
  update(dt, nearStation, speedMul = 1) {
    if (!this.job) return null;
    const j = this.job;
    j.t += dt * speedMul;
    const progress = Math.min(1, j.t / j.recipe.time);
    if (progress < 1) return { done: false, progress };
    this.job = null;
    // re-validate at completion; ingredients may have moved during the timer
    if (!this.canCraft(j.recipe, j.inv, nearStation)) return { done: true, ok: false, msg: 'Missing ingredients' };
    const out = ItemDB.create(j.recipe.out, j.recipe.qty);
    out.qty = j.recipe.qty;
    // ensure output fits before consuming
    const probeRoom = j.inv.canAdd(out) || freedByConsumption(j.inv, j.recipe, out);
    if (!probeRoom) return { done: true, ok: false, msg: 'No room for the result' };
    j.inv.consume(j.recipe.in);
    const left = j.inv.add(out);
    return { done: true, ok: true, msg: `Crafted ${ItemDB.get(out.id).name}${out.qty > 1 ? ` ×${out.qty - left}` : ''}`, leftover: left ? { id: out.id, qty: left } : null, progress: 1 };
  }
}

function freedByConsumption(inv, recipe, out) {
  // if consuming ingredients empties a slot, the output may fit there
  for (const [id, n] of Object.entries(recipe.in)) {
    if (inv.count(id) === n) return true;
  }
  void out;
  return false;
}
