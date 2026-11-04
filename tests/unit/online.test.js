// Online server logic without sockets: fake connections drive the real GameServer.
import { describe, it, expect } from 'vitest';
import { GameServer } from '../../server/GameServer.js';
import { serverUrl } from '../../src/net/NetClient.js';
import { PROTOCOL_VERSION } from '../../src/net/protocol.js';

function client(s, name) {
  const sent = [];
  const ws = { readyState: 1, send: (d) => sent.push(JSON.parse(d)), close() {}, on() {} };
  const c = { ws, player: null, known: new Map(), knownPlayers: new Set(), send(o) { ws.send(JSON.stringify(o)); }, sent };
  s.conns.add(c);
  s._onMessage(c, { t: 'hello', v: PROTOCOL_VERSION, name });
  return c;
}
const of = (c, t) => c.sent.filter((m) => m.t === t);

describe('online server', () => {
  const s = new GameServer({});
  const g = s.game;
  const poi = g.world.pois.find((p) => p.type === 'farmstead' && p.garrison?.length);
  const A = client(s, 'Alice');
  const B = client(s, 'Bob');
  const at = (dx) => ({ x: poi.x + dx, z: poi.z + poi.radius + 40 });
  const pa = at(0), pb = at(5);
  for (const [c, p] of [[A, pa], [B, pb]]) s._onMessage(c, { t: 'spawn', x: p.x, y: g.world.heightAt(p.x, p.z), z: p.z, yaw: 0 });
  for (let i = 0; i < 30 * 4; i++) s.tick(1 / 30);

  it('welcomes players and rejects other protocol versions', () => {
    expect(of(A, 'welcome')[0].id).toBe('p1');
    expect(of(B, 'welcome')[0].players.map((p) => p.name)).toEqual(['Alice']);
    const bad = { ws: { readyState: 1, send() {}, close() {} }, player: null, send(o) { this.last = o; } };
    s._onMessage(bad, { t: 'hello', v: -1 });
    expect(bad.last.t).toBe('reject');
    expect(bad.player).toBe(null);
  });

  it('builds the location around players and spawns its garrison', () => {
    expect(g.pois.active.has(poi.id)).toBe(true);
    expect(g.ai.agents.filter((a) => a.garrisonOf === poi.id).length).toBeGreaterThan(0);
    expect(g.propChunks.size).toBeGreaterThan(0);
  });

  it('sends each player the AI and the other player', () => {
    const snap = of(A, 'snap').at(-1);
    expect(of(A, 'snap').some((m) => m.s?.length)).toBe(true);
    expect(snap.p.map((e) => e[0])).toEqual([B.player.id]);
  });

  it('re-simulates player shots: AI die, killer credited, others see the shots', () => {
    let killed = false;
    for (let i = 0; i < 30 * 90 && !killed; i++) {
      if (i % 2 === 0) for (const [c, p] of [[A, pa], [B, pb]]) s._onMessage(c, { t: 'st', x: p.x, y: g.world.heightAt(p.x, p.z), z: p.z, yaw: 0, st: 'crouch', alive: true, w: 'wpn_arv7' });
      if (i % 10 === 0) {
        const tg = g.ai.agents.filter((a) => a.alive).sort((a, b) => Math.hypot(a.pos.x - pa.x, a.pos.z - pa.z) - Math.hypot(b.pos.x - pa.x, b.pos.z - pa.z))[0];
        if (tg) {
          const o = [pa.x, g.world.heightAt(pa.x, pa.z) + 1.1, pa.z];
          const d = [tg.pos.x - o[0], tg.pos.y + 1.2 - o[1], tg.pos.z - o[2]];
          const L = Math.hypot(...d);
          s._onMessage(A, { t: 'fire', o, d: [d.map((v) => v / L)], w: 'wpn_arv7' });
        }
      }
      s.tick(1 / 30);
      killed = of(A, 'kill').length > 0;
    }
    expect(killed).toBe(true);
    expect(of(B, 'shot').some((m) => m.s === A.player.id)).toBe(true);
    expect(of(B, 'die').length).toBeGreaterThan(0);
  });

  it('shares bodies; a stale edit is refused', () => {
    const k = g.ai.corpses[0];
    expect(k).toBeTruthy();
    for (const [c, p] of [[A, pa], [B, pb]]) { p.x = k.agent.pos.x + 1; p.z = k.agent.pos.z; s._onMessage(c, { t: 'spawn', x: p.x, y: k.agent.pos.y, z: p.z, yaw: 0 }); }
    s._onMessage(A, { t: 'corpse', id: k.agent.id });
    const view = of(A, 'corpse').at(-1);
    const n = view.inv.slots.filter(Boolean).length;
    expect(n).toBeGreaterThan(0);
    const taken = { ...view.inv, slots: view.inv.slots.map((x, i) => (i === view.inv.slots.findIndex(Boolean) ? null : x)) };
    s._onMessage(A, { t: 'corpse:set', id: k.agent.id, rev: view.rev, inv: taken });
    expect(k.inv.usedSlots()).toBe(n - 1);
    // Bob edits from the old revision: refused, gets the current contents back
    s._onMessage(B, { t: 'corpse:set', id: k.agent.id, rev: view.rev, inv: view.inv });
    const back = of(B, 'corpse').at(-1);
    expect(back.denied).toBe(true);
    expect(k.inv.usedSlots()).toBe(n - 1);
  });

  it('syncs doors players can reach, and corrects ones they cannot', () => {
    const [id, d] = [...g.doors].find(([, x]) => !x.open);
    const near = { x: d.center.x + 1, z: d.center.z + 1 };
    s._onMessage(A, { t: 'st', x: near.x, y: d.center.y - 1, z: near.z, yaw: 0, alive: true });
    s._onMessage(A, { t: 'door', id, open: true });
    expect(d.open).toBe(true);
    expect(of(B, 'door').at(-1)).toMatchObject({ id, open: true });
    s._onMessage(B, { t: 'st', x: d.center.x + 200, y: d.center.y, z: d.center.z, yaw: 0, alive: true });
    s._onMessage(B, { t: 'door', id, open: false });
    expect(d.open).toBe(true);
    expect(of(B, 'door').at(-1)).toMatchObject({ id, open: true });
  });

  it('PvP is off by default', () => {
    expect(g.characters.pvp).toBe(false);
  });

  it('turns typed addresses into WebSocket URLs', () => {
    expect(serverUrl('iron-veil.onrender.com')).toBe('wss://iron-veil.onrender.com/ws');
    expect(serverUrl('https://iron-veil.onrender.com/')).toBe('wss://iron-veil.onrender.com/ws');
    expect(serverUrl('localhost:8080')).toBe('ws://localhost:8080/ws');
    expect(serverUrl('wss://x.example/ws')).toBe('wss://x.example/ws');
  });
});
