# Operation Iron Veil

A first-person open-world survival shooter that runs in the browser. You arrive in **Vesper**, a fictional
16 × 16 km region in a post-collapse, Eastern-European-inspired country, with nothing but clothes and a flashlight.
Every enemy is human: the Vesper Security Force, the Iron Wolves, settlement guards, mercenary free
companies and other survivors. There are no zombies, monsters or supernatural elements.

Built with Three.js (WebGL), Web Audio, Pointer Lock and IndexedDB. Everything — terrain, buildings,
weapons, characters, textures and sound — is generated procedurally in code; no third-party art or audio
assets are used.

---

## Requirements

* Node.js 18 or newer (tested with Node 22) and npm
* A desktop browser with WebGL 2 (Chrome/Edge 110+, Firefox 115+, Safari 16.4+)
* Mouse and keyboard

## Commands

```bash
npm install          # install dependencies
npm run dev          # development server with hot reload → http://localhost:5173
npm run build        # production build into dist/
npm run preview      # serve the production build → http://localhost:4173
npm test             # unit tests (Vitest), including simulated AI firefights
npm run test:sim     # AI firefight scenario report (headless, ~1-3 s per fight)
npm run test:e2e     # automated browser playtest (Playwright, needs `npm run build` and a Chrome/Chromium)
node tests/e2e/features.mjs # debug menu, traders, sentries, farms, lights, ladders (needs `npm run build`)
```

`npm run test:e2e` starts its own preview server. Environment variables: `PREVIEW_URL` (reuse a running
server), `QUALITY` (low/medium/high/ultra), `VW`/`VH` (viewport), `CHROME_PATH` (path to a Chrome binary; otherwise Playwright's bundled Chromium is used),
`--only=stage1,stage2` to run selected stages. Screenshots go to `tests/e2e/screenshots/`.

## Hosting

`npm run build` produces a fully static site in `dist/` with relative paths (`base: './'`). Upload the
contents of `dist/` to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3, nginx, itch.io HTML
upload). No server code or special headers are required. Opening `dist/index.html` directly from disk
(`file://`) does **not** work because browsers block module workers on `file://`; use a web server.

## Saving — please read

* Saves live in **your browser's IndexedDB** for the site's origin (with a localStorage fallback).
  There is one autosave slot (every few minutes and whenever an objective completes) and three manual slots.
* Each write keeps the previous copy as a backup; if the main record is corrupted or fails validation,
  the backup is loaded instead.
* **Saves are lost if you clear site data / browsing data, or if you play in a private/incognito window.**
* Saves are **not** synchronised and **do not** transfer to another browser, device or domain.
  A different URL (e.g. localhost:5173 vs. localhost:4173) is a different origin with separate saves.
* Settings are stored separately in localStorage.

## Controls

| Action | Key |
|---|---|
| Move / look | W A S D / mouse |
| Sprint · crouch · prone · jump | Shift · C · Z · Space |
| Fire · aim down sights | LMB · RMB |
| Hold breath (scoped) | Shift while aiming |
| Reload / clear jam · fire mode | R · B |
| Weapon slots · holster | 1 2 3 4 · X |
| Quick items | 5 6 7 8 |
| Interact / loot / open door / enter vehicle | E |
| Secondary action (lock, refuel, fill water) · climb a ladder to the other end | F |
| Flashlight (works unarmed too) · inspect weapon | T · Y |
| Inventory · map · build · crafting · journal | Tab or I · M · G · H · J |
| Rotate building piece | Q |
| Map marker at your position | N |
| Vehicle: throttle/brake/steer · handbrake · lights (off → low → high) · exit | W/S/A/D · Space · L · E |
| Debug menu (code 3209) | hold Tab, press 3 |
| Pause | Esc |

Click the game view to capture the mouse. Releasing the pointer (Esc) opens the pause menu.

## Riverside, traders and base production

* **Riverside Settlement** (south-west, on the highway) is the biggest place in Vesper: a market street
  with six traders behind their stalls, townsfolk you can talk to, a hall, clinic, workshop, homes and a
  palisade with four towers. Shooting its people turns the Settlement Guard against you.
* **Trading is barter.** Traders pay half value for what you sell and charge full value; good standing
  with the Guard lowers prices. Cigarettes and watches are good trade goods. Stock refills daily.
  The gunsmith repairs weapons, the medic treats wounds, the quartermaster posts three delivery jobs a
  day, and the elder tells you where places are (marked on your map).
* **New base pieces** (G): **Sentry Gun** — load a firearm and its ammunition; it fires on hostile
  people it can see, reloads from storage, and goes quiet when empty. **Lumber Yard** (20 planks per
  in-game day) and **Scrap Workshop** (5 scrap metal per day) produce while you are away; collect from
  them with E. **Fuel Pump** — refills an empty jerrycan (up to 3 per day, stores 6).

## Debug menu

Hold **Tab** and press **3**, enter **3209** on the keypad. ↑/↓ move, Enter selects, ←/→ change values,
Backspace goes back or closes; the number pad works too (8/2/4/6, 5, 0). Pages: Teleport (waypoint,
any landmark, markers, base, vehicle), Player (heal, god mode, unlimited stamina/ammo/carry, no
hunger, AI ignore you, max skills), Items (every item by category, kits), World (time, weather, reveal
map, remove hostiles, spawn squads, restock containers), Base (free building, repairs, produce now,
refill sentries), Vehicles, Debug (FPS, coordinates, speed). The code is only a lock against opening
it by accident — anyone reading the source can see it.

## First 20 minutes (vertical slice)

1. Start a new game on the coast road south of **Millbrook Village**.
2. The objective tracker guides you into Millbrook — search the houses (hold E on containers).
   The first marked cupboard always contains a VK-9 pistol and 9 mm ammunition.
3. Search further for food, water, bandages and tools. Drink or fill empty bottles at the lake and rivers (F, looking down at the water) or at settlement water points (E).
4. Independent scavengers pick through Millbrook (neutral unless provoked); Iron Wolves raiders hold the Rural Farmstead about 1.2 km north-east. Fight them, or avoid them.
5. Loot their bodies (E) for weapons, ammunition and gear.
6. Collect wood planks and nails (Logging camp, farms, warehouses) plus a hammer.
7. Open the build menu (G), place a foundation, walls, a door and a storage crate. Store items in the crate.
8. Save from the pause menu, reload it — the base and its storage come back.
9. Travel north (on foot or by a vehicle that needs fuel) to **Northwatch Military Base** for military loot,
   defended by the Vesper Security Force.

## Implemented systems

**World** — Deterministic 16.4 km terrain from layered noise with 10 regions (Vesper Valley, Blackwood Forest,
Greywater, Ironhaven, Northwatch, Redstone Ridge, Old Vesper, The Outer Farms, The Barrens, Lake Meridian),
two rivers, a lake, highways/roads/dirt tracks, a railway with bridges, power lines and fences. 28 data-driven
points of interest (`src/data/locations.json`): Millbrook Village, farmstead, hunting cabins, ranger station,
communications tower, logging camp, highway checkpoint, Northwatch Military Base, evacuation centre, hospital,
police department, residential district, shopping centre, industrial complex, warehouse district, railway
yard, water treatment plant, riverside settlement, granary, dam facility, fuel depot, marina, underground
storage, quarry, radar station, research facility, prison and a fortified survivor compound. Buildings are
procedurally assembled with enterable interiors, doors, stairs, windows, furniture and loot containers.

**Streaming & rendering** — Terrain generated in Web Workers in 128 m chunks with three LOD levels plus
512 m far tiles out to the horizon; splat-mapped terrain shader; instanced trees/bushes/rocks/grass with a
single texture atlas, wind animation and distance fading; POIs build when you approach and unload when far;
cascaded-style following shadow map; procedural sky, sun, moon, stars, fog, PMREM environment lighting;
optional ambient occlusion; colour grading, vignette and film grain; separate viewmodel pass.

**Day / night & weather** — 24 h cycle (one game day = 60 real minutes), clear,
overcast, fog, rain and storms with lightning/thunder; rain affects visibility and audio; night is genuinely
dark and requires a flashlight or lamps.

**Player** — Walking, sprinting, crouching, prone, jumping, ladders, stamina, fall damage, collision with
step-up, head bob/sway, encumbrance.

**Survival & medical** — Health, hunger, hydration, stamina, body temperature and wetness (weather, clothing,
rain protection, campfires, shelter), bleeding wounds that stack, pain (affects aim); bandages, improvised
bandages, field medical kits, painkillers and saline bags.

**Weapons** — 15 weapons: VK-9 Compact, Harrow .45, M-6 Service Revolver, Fieldline 12P, Breaker S12, Kestrel
SMG, AR-V7 Rifle, LK-4 Carbine, VBR-30 Battle Rifle, Sentinel DMR, Ridgeline M90, Anvil LMG, Homestead Hunter,
Rebar Club and Combat Knife. Each has its own fire rate, modes, magazine, reload (tactical/empty), recoil
pattern, spread, ADS time and zoom, sound signature, damage falloff and penetration. Projectile ballistics
with gravity and travel time, penetration through thin materials (wood, glass, sheet metal) with energy loss,
hit zones (head/torso/arms/legs), armour, weapon condition and jamming, magnifying optics with scope
sway/hold breath, suppressors, extended magazines, grips and lights. Procedural viewmodels, muzzle flash,
tracers, impacts and decals.

**AI** — Five factions with relationships that change when you attack them, each fighting by a
doctrine. **Disciplined** soldiers and mercenaries (VSF, Free Companies, settlement guards) move cover to cover,
fire short bursts, suppress while a teammate flanks, cover a reloading teammate, investigate and search as a
fireteam (one moves while the others watch), stay within a leash around the location they defend, and fall
back to a rally point in order when the squad is losing. **Aggressive** raiders (Iron Wolves) push to close
range, flank alone, fire long bursts, chase far and loot the dead. **Cautious** survivors avoid fights they did
not start, move away from distant gunfire, engage only up close or when attacked, slip away at the first pause
and go back to scavenging. Agents see with a field of view, distance, light, posture and muzzle flashes, and
hear gunfire, footsteps, doors, shouts and death cries; walls and terrain shorten how far a sound carries and
blur where it came from. Squads share contacts by voice (short range) or radio (soldiers), with delays in game
time. Combat uses real line of sight and line of fire: AI only fires when facing the target, never through
cover or teammates, never while sprinting, and holds fire beyond its weapon's effective range. Ammunition is
finite: AI reloads (in cover when it can), switches to its sidearm, scavenges bodies for ammunition or a loaded
gun, and disengages when empty. Morale drops with wounds, casualties and incoming fire and recovers in cover;
a cornered agent fights instead of turning its back. Movement uses A* on a grid built from real colliders;
flanking and falling back prefer routes the enemy cannot see, flanks across open ground are refused, and stuck
agents side-step, re-path, then give up on the goal. Distant agents are simulated at lower frequency. Dynamic
world events: patrols, armed convoys, faction skirmishes, scavenger groups, guarded supply caches and raids on
the player's base — all driven by the same AI systems.

**Inventory** — Slot grid with equipment slots (head, body, vest, back, utility; weapon slots primary,
shoulder, sidearm, melee), backpacks that add capacity, weight, drag-and-drop, click and context actions,
split, combine, sort, drop to ground piles, weapon attachments, quick slots. Unit tests verify that transfers
never duplicate or lose items.

**Looting** — Deterministic per-container loot from location profiles (residential, farm, medical, police,
military, industrial, …), timed searching, restocking only for emptied containers, corpses and dropped piles.

**Base building** — 20 pieces (foundation, floor/roof, wooden and reinforced walls, door frame, door, double
gate, window wall, firing-position wall, stairs, ladder, sandbags, steel barrier, watchtower, storage crate,
lockable locker, workbench, bedroll respawn, lamp, campfire). Ghost preview with valid/invalid colouring,
grid snapping, rotation, support and overlap validation, material cost consumed only on successful
placement, health, repair, dismantle with partial refund, lockable doors/storage, and raids by AI that
damage pieces. Everything is saved.

**Crafting** — Field and workbench recipes (improvised bandage, rope, empty sandbags, rebar club, planks,
metal sheet, nails, bolts, day pack) with tool and station requirements and craft times; weapon and
structure repair.

**Vehicles** — Civilian pickup, utility van, military transport and off-road 4×4 with simplified physics
(suspension feel, grip, handbrake), fuel consumption, damage, headlights, engine audio, storage and
refuelling from jerrycans and pumps.

**Map** — Generated paper map with terrain shading, roads, rivers, regions and names; fog of war that is
revealed as you explore; discovered POIs; player marker and heading; custom markers and waypoint (shown on
the HUD compass). Map items reveal regions.

**Progression** — Grounded skills that improve by doing (weapon handling, marksmanship, scavenging,
medical treatment, construction, crafting, survival, vehicle operation), a journal with discovered locations, lore pages and faction standing.

**Audio** — Fully synthesised in Web Audio: distinct gunshots per calibre with distance filtering, echo
and speed-of-sound delay, suppressed shots, impacts, footsteps per surface, reloads, ambience for forest,
wind, rain, night insects, water, engines, UI sounds. Master / weapons / ambience / vehicles / interface
volume buses.

**UI** — Main menu, loading screen, HUD (health/blood/food/water/stamina/temperature, compass, ammo,
interaction prompts, damage direction indicator, notifications), pause menu, settings (graphics preset,
render resolution, view distance, shadows, vegetation, grass, effects, textures, AO, post-processing, FOV,
sensitivity, invert Y, head bob, camera shake, HUD scale, audio buses,
AI difficulty, hunger/thirst rate, world-event frequency, loot restock interval), save/load management, death screen and respawn (at bedroll or random coast).

## Known limitations (honest list)

* **Performance has not been measured on real GPU hardware.** Development and automated tests ran in a
  cloud container with software WebGL (about 1–10 fps). Start with the "Medium" preset on a discrete GPU
  and "Low" on integrated graphics, and adjust view distance / shadows / vegetation in Settings.
* AI navigation covers ground floors (including raised floors and door steps) and open ground; AI does not climb interior stairs to upper floors.
* Corpses and AI agents are not persisted in saves; world events regenerate after loading.
* Door open/closed states in POIs are not saved (base doors and locks are).
* Base raids only happen while the player is within about 600 m of their base.
* Changing the **Texture quality** setting is applied after reloading the page.
* There is no music score.
* Medical model has no fractures or infections; no tourniquets/splints/antibiotics.
* Vehicles use simplified arcade-style physics; there is no vehicle damage model per part.
* Single player only (an online co-op prototype was built and then removed to save hosting costs; see MANIFEST).
* Gamepad is not supported.

## Performance notes

* **Chromebook preset** (Settings → Graphics → Chromebook; chosen automatically on first launch on ChromeOS):
  60 % render resolution with high-DPI scaling ignored, no shadows, 600 m view distance, sparse vegetation, no
  grass, no post-processing, 128 px textures, no anti-aliasing and simple materials (colour texture only, no
  surface-detail/roughness maps, no weathering shader). Texture size and simple materials apply after a
  reload; the settings screen offers a "Reload now" button that saves first. On this project's software
  renderer the same view took 1.5 s per frame on Chromebook vs 7.0 s on Low (4.6x faster); real-GPU gains will
  differ and were not measured.

* Terrain generation runs in up to three Web Workers; chunks are prioritised by distance and LOD.
* Vegetation: one instanced draw per species/LOD with a shared atlas; grass only near the player.
* Buildings merge geometry per material (a typical house is 4–8 draw calls).
* NPCs are single skinned meshes; AI far from the player updates at reduced frequency.
* Lights: a fixed pool of point/spot lights is reassigned to the nearest sources to keep shader counts stable.
* Sun shadows use cascades: High = 3 cascades (22/75/260 m), Medium = 2, Low = a single 70 m map.
  Shadow cascades and GTAO are the most expensive settings; lower them first if the frame rate drops.
* Weapon, item and character geometry is cached and shared; NPCs use low-detail weapon models.
* An in-game profile is available via `window.__IV.state().profile` in the browser console.

## Project structure

```
src/
  core/        Game orchestrator, input, settings, saves, clock, objectives, events
  engine/      Renderer, lighting/sky, materials, procedural textures, physics, light pool
  world/       World data & noise, terrain streaming + workers, vegetation, POIs, buildings, roads, weather, map
  player/      Player, movement controller, survival/medical
  weapons/     Weapon data, controller, ballistics, viewmodels, effects
  combat/      Damage model, humanoid hit-testing
  ai/          Agents, manager, factions, navigation grid, character models, world events
  items/       Item database, inventory, equipment, loot, crafting, item icons
  basebuilding/ Base system and piece models
  vehicles/    Vehicle system
  audio/       Synthesised audio engine
  ui/          UI manager, HUD, inventory, map, crafting/building, settings
  data/        JSON: weapons, items, loot tables, factions, locations, building, vehicles
  npc/         Settlement traders and townsfolk
tests/unit     Vitest unit tests
tests/e2e      Playwright playtest scripts
```

See `MANIFEST.md` for the development manifest (status of every system, remaining work, known bugs).

## Test results

Latest run, after the tactical AI pass (details in `MANIFEST.md`): production build succeeds; **48/48 unit
tests pass**, including six simulated AI firefights; a 56-fight simulator sweep had no stuck agents, no agents
inside geometry and no shots fired while facing away; the browser playtest passed every stage with 0 console
errors (12/13 in the full run, the AI-combat stage on a rerun after making it wait for the AI's reaction rather
than a fixed game time). Not tested: real-GPU frame rate, audio output and real mouse input.

## AI firefight simulator

`tests/sim/` runs the real AI, buildings, physics, ballistics, damage and factions without a renderer, many
times faster than real time. `npm run test:sim -- --seeds=3` prints, for each scenario (squad vs squad in
farmland and in Millbrook, a player attacking the checkpoint garrison, distant gunfire, breaking contact and
hiding, ammunition starvation, night contact): shots, hit rate, deaths, reloads, share of combat time in cover,
time standing idle in the open, tactics used (cover moves, peeks, suppression, flanks, searches, retreats,
body looting) and violations (stuck agents, agents inside geometry, shots fired while facing away, friendly
fire). Add `--log` for a per-agent timeline. `tests/unit/ai_sim.test.js` turns the key expectations into tests.

## Visual reference renders

`node tests/e2e/visual.mjs --quality=high [--views=v01-street,v03-interior]` (with `npm run preview`
running) renders fixed camera views listed in `tests/e2e/visual-views.mjs` with the HUD hidden. Use it to
compare art changes; it takes several minutes per view on software WebGL.

## Debug API

In the browser console, `window.__IV` exposes: `state()`, `teleport(x, z)`, `give(id, qty)`, `equip(id)`,
`setTime(hours)`, `weather(type)`, `spawn(profile, distance)`, `look(yaw, pitch)`, `frames(n)`,
`gameSeconds(s)` (promises for test scripts) and `setMaxDt(s)` (lets the simulation keep pace with
very slow headless renderers). Photo helpers: `cam(x, y, z, tx, ty, tz)` / `cam(null)`, `ground(x, z)`,
`photo(on)`, `busy()`.
