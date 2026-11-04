# Iron Veil — Development Manifest

Persistent record of project state. Update this file whenever a system changes status.

## Status legend
* **Done** — implemented, exercised in the browser and/or by tests.
* **Partial** — works, with the gaps listed.
* **Not done** — not implemented.

## Systems

| System | Status | Main files | Notes / gaps |
|---|---|---|---|
| Build tooling | Done | package.json, vite.config.js | Vite 5, Three r169 split into its own chunk |
| World data & terrain noise | Done | world/WorldData.js, data/locations.json | Deterministic seed, 10 regions, rivers, lake, roads, rail, bridges, POI pads |
| Terrain streaming | Done | world/TerrainManager.js, TerrainWorker.js, ChunkGenerator.js | Workers, 3 LODs + far tiles, skirts, splat shader |
| Vegetation | Done | world/VegetationModels.js | Branch-skeleton trees, per-quadrant mipmapped atlas, alpha grass cards, ferns, hay bales, hedgerows, per-instance tint/scale |
| POIs & buildings | Done (visual pass 2) | world/POIManager.js, POILayouts.js, BuildingGenerator.js, Structures.js | 28 POIs, enterable interiors, containers; door states not saved |
| Infrastructure | Done | world/Infrastructure.js | Roads, rail, bridges, power lines, fences |
| Lighting, sky, post | Done | engine/Lighting.js, Renderer.js, Atmosphere.js, SunShadows.js | Cloud/haze sky, height fog with sun in-scatter, cascaded sun shadows (1–3 cascades by preset), indoor sky-light suppression + eye adaptation, GTAO (clamped, foliage excluded), colour grade |
| Weather & day/night | Done | world/WeatherSystem.js, core/GameClock.js | Clear/overcast/fog/rain/storm, lightning |
| Physics | Done | engine/PhysicsWorld.js | AABB + cylinders, spatial hash, raycasts with penetration |
| Player movement | Done | player/PlayerController.js | Stances, ladders, step-up, fall damage |
| Survival & medical | Partial | player/PlayerSurvival.js | No fractures/infection |
| Weapons | Done | weapons/* , data/weapons.json | 15 weapons, attachments, ballistics, jams |
| Damage model | Done | combat/* | Zones, armour, falloff, penetration |
| AI | Done (tactical pass) | ai/AIAgent.js, Squad.js, Doctrine.js, AIManager.js, NavGrid.js | Doctrines, squad fire-and-movement, sound propagation, LKP search, ammo/scavenging, stuck recovery; no upper-floor navigation, no grenades, AI never goes prone |
| Factions | Done | ai/FactionManager.js, data/factions.json | Dynamic standing |
| World events | Done | ai/WorldEvents.js | Patrols, skirmishes, scavengers, convoys, caches, base raids (player within ~600 m) |
| Inventory & equipment | Done | items/Inventory.js, Equipment.js, ui/InventoryUI.js | Unit-tested no-dupe transfers |
| Loot | Done | items/LootSystem.js, data/lootTables.json | Deterministic, restock only when emptied |
| Crafting & repair | Done | items/CraftingSystem.js, data/building.json | 9 recipes |
| Base building | Done | basebuilding/* | 20 pieces, validation, raids, persistence |
| Vehicles | Partial | vehicles/VehicleSystem.js | Arcade physics, no per-part damage |
| Map & fog of war | Done | ui/MapUI.js, world/MapGenerator.js | Markers, waypoint, compass |
| Audio | Done | audio/AudioManager.js | Synthesised; no music score |
| UI / menus / settings | Done | ui/* | Texture setting needs reload |
| Saves | Done | core/SaveManager.js | IndexedDB + backup + validation; AI/corpses not saved |
| Objectives (vertical slice) | Done | core/Objectives.js | arm → loot → materials → build → explore |
| Progression & journal | Done | player/Player.js | 8 skills, lore pages |
| Online co-op | Partial (stage 1) | server/*, net/*, docs/ONLINE.md, render.yaml | Shared server-run AI, gunfights, bodies, doors, time, weather, factions, chat; client-trusted movement, no lag compensation; containers/bases/vehicles per player; no world events or raids on servers; shared world not persisted |

## Online co-op, stage 1 (2026-11-05)
Goal: friends play in one shared world, hosted for free (Render), reachable from the user's Zite site.

* **Architecture.** One Node process (`server/index.js`) serves `dist/` over HTTP and the world over
  WebSocket `/ws`. `HeadlessGame` reuses the real modules without a renderer (WorldData, PhysicsWorld,
  POIManager layouts, door colliders via the new shared `addDoorCollider`, ChunkGenerator tree/rock
  colliders, AIManager/AIAgent/Squad, Ballistics, FactionManager, GameClock, WeatherSystem) and builds
  locations within 650 m and prop colliders within 420 m of any player, unloading beyond 900/600 m.
* **Authority.** Server: AI, damage to AI, bodies (revisioned; stale edits refused), doors (reach-checked;
  rejected toggles are corrected on the sender), time, weather, faction standing. Client: own movement
  (speed sanity check), health/armour (server forwards hits with zone, weapon, distance, penetration loss),
  inventory, containers, bases, vehicles.
* **Shots.** Player shots are batched per frame and re-simulated on the server with the player as
  shooter (origin and fire-rate checks), so AI hear, suppress and react as in single player. Every shot is
  relayed to players within 1.1 km and replayed with `shot.visual` (new Ballistics flag: impacts, blood,
  tracers, sound — no damage, no suppression, no hit events). Melee on AI is sent by id.
* **AI changes for many players.** AIManager uses `observers()` (nearest player) for spawning, despawning
  and LOD; sounds carry their source character; AIAgent's player-attack check is `isPlayer` + faction
  instead of identity; agents keep `look` and per-frame `anim` for snapshots; HeadlessModel records the death pose.
* **Client.** `NetClient` (state at 15 Hz, ping, chat on Enter, body mirror, door index), `RemoteAgent` /
  `RemotePlayer` (CharacterModel, name tag, interpolation 0.13 s behind snapshots at 12 Hz, footsteps,
  flashlight cones, body interactable). Online mode skips local AI and world events, does not pause the
  simulation in the menu, saves to a separate `online` slot and restores only the player's own state.
  `Characters.pvp` (default off on servers) filters player-vs-player hits on both sides.
* **UI.** Main menu **Play Online** (server address, name; `?server=` / `&join=1` URL parameters), online
  pause menu (Save Character / Leave Server), chat log, FPS line shows players online and ping.
* **Hosting.** `render.yaml` (free web service, `npm ci --include=dev && npm run build:all`, `npm start`,
  health check `/health`). Guide for the user in `docs/ONLINE.md`.

## Visual upgrade (pass 2) — art direction
Realistic, muted military-survival look: overcast-leaning daylight, desaturated greens and ochres,
weathered paint and concrete, no saturated "game" colours. Every standard material gets the same
weathering layer (rain streaks, grime at the base, tone drift), so props share one visual language.

| Area | What changed |
|---|---|
| Terrain | 4-channel splat (dirt, sand, wheat, plowed) with macro variation, organic blend edges, crop rows/furrows, dirt pads under POIs |
| Roads/rivers | Ribbon winding bug fixed (roads, rail and rivers were back-face culled and invisible before); worn asphalt with patches, puddles in rain, rutted dirt tracks; bridge railings; road signs and km posts; 6 wreck variants |
| Buildings | Framed windows with sills/lintels/shutters, socles, quoins, cornices, door surrounds and steps, canopies, gutters/downpipes, ridge caps, antennas, chimney caps; tiled/sheet/rusted roofs; per-building facade tint; interiors marked "indoor" so they are not lit by the sky |
| Landmarks | Millbrook church with tower, belfry, clock and spire; war memorial, well, bus stop, yards with laundry lines and vegetable beds; Northwatch: paved spine, T-wall gate, hangar, water tower, comm mast with banding and warning lights, military trucks, floodlights; farmstead tractor, hay stacks, orchard |
| Vegetation | See systems table |
| Lighting | See systems table |
| Weapons | Rounded, bevelled viewmodels with detailed receivers, sights and furniture; gloved hands with fingers and a watch; reload choreography (magazine out/in, charging handle), landing dip, strafe lean |
| Characters | Plate carriers with pouches, radios, helmet with NVG mount, knee pads, boots; idle breathing, weight shift and look-around |

Checked by rendering fixed reference views (`tests/e2e/visual.mjs`) at the High preset in headless
Chrome (software WebGL) and inspecting them: street, house, interior, village aerial, valley, cabins
clearing, Northwatch gate and aerial, the comm tower at night, and both weapon viewmodels.
**Not inspected after the final changes:** the church (v18), yards (v19), hangar (v20), soldier close-ups
(v17), farmstead (v11), dusk/rain (v12/v14) and the last interior-brightness and gate-wall tweaks. They
build without errors (unit tests) but were not looked at in a render; before/after JPEGs are in `docs/screenshots/` (the weapon after-shot predates a final material-brightness tweak).
**Frame rate on real GPUs was not measured** — the extra geometry, cascaded shadows and per-material
weathering cost more than before. Use the Medium preset (2 cascades) or Low (1 shadow map, no AO) on
weaker hardware.

## Bug sweep (2026-11-04, evening)

* **AI could not path through doorways.** The navigation grid padded every collider by 0.35 m and blocked any
  cell the padding touched, so 1 m doors were sealed: 149 of 199 building doors had no AI path inside (the player
  was unaffected). Cells are now blocked only when their centre is too close to a collider; paths try a cheap grid
  first and a fine 0.5 m grid when it fails; cells next to walls cost more so routes keep a body's width from
  walls. Village fights went from 49–90 failed paths per fight to 2–11 (almost all of them flanks rejected for
  crossing open ground), and time in cover rose from ~45 % to 50–60 %.
* **Raised floors.** The grid treated building plinths above 0.5 m as solid, so buildings on slopes (the
  hospital, warehouses, dam, parts of Old Vesper) were unreachable to AI. Wide surfaces are now floors with a
  0.42 m climb limit between cells, matching the 0.45 m step-up of the walking physics.
* **Doors you could not walk through.** On slopes a door could stand over a metre above the ground with only a
  decorative (non-colliding) step block in front of it, so even the player could not get in. Every door now has a
  real staircase from the ground in front of it up to the floor (0.2 m risers, 30 cm treads).
* **Fences across doors.** Yard and garden fences assumed every house's door faces the street; fences now leave
  a gap wherever they would pass a building door (including garden sheds), and yard trees are no longer planted
  through shed roofs.
* **Neutral factions followed the player around** investigating footsteps and doors of people they are not
  hostile to. Only hostile or unknown sources are investigated now.
* **Chromebook mode interiors** lost the indoor lighting correction together with the weathering shader and
  filled with blue sky light; a texture-free version of the correction now runs in Chromebook mode.
* Interiors brightened slightly (less indirect-light cut, stronger indoor albedo compensation).
* Respawn is guarded against double clicks.
* New test `tests/unit/navigation.test.js`: every building door in all 28 locations must have an AI path inside
  and the path must be walkable by a player-sized body with the real physics (199 doors: 198 pathable, 195
  walkable; the rest are a tiny sentry booth and loading-dock stair corners where the AI's stuck recovery applies).

## Chromebook mode, floor and spawn fixes (2026-11-04)

* **Chromebook preset** — see README "Performance notes". New settings: `lite` (simple materials, no
  anti-aliasing) and 128 px textures; both are boot-time (reload prompt in Settings). Measured with
  `tests/e2e/fps.mjs`: 1546 ms vs 7047 ms per frame (Chromebook vs Low) at the Millbrook street view on
  SwiftShader, 421k vs 746k triangles, 0.33 vs 0.52 megapixels.
* **Floors flickering into each other** — every ground floor's surface was exactly coplanar with the top of its
  concrete plinth (z-fighting); it now sits 1.5 cm higher. Paved areas were tilted 6 m tiles that overlapped
  their neighbours at slightly different heights, and overlapping paved areas (Northwatch spine road across
  the parade ground and motor pool) were at identical heights; paving is now one continuous terrain-following
  surface with a kerb skirt, each further paved area 2 cm higher. Camera near plane 0.08 → 0.15 m doubles
  depth precision at distance.
* **Spawning** — respawning teleported the player to a spawn point or bedroll up to ~1 km away without loading
  that area, so the player could appear before terrain, buildings and props existed (and end up inside them).
  Respawn now shows the loading screen and streams the area in first. After every new game, load and respawn
  the player is placed on clear ground: if anything overlaps them (tree, rock, wreck, wall, deep water) they are
  moved to the nearest clear spot on open ground within 40 m. New playtest stage `respawn` checks it.

## Tactical AI pass

| Behaviour | How it works | Where |
|---|---|---|
| Doctrines | disciplined (VSF, Free Companies, guards), aggressive (Iron Wolves), cautious (survivors): ranges, cover use, peek timing, burst length, suppression, flanking, chase distance, leash, morale thresholds, looting | ai/Doctrine.js |
| Squad brain | shared contacts by voice (45 m) or radio (soldiers) with game-time delays; picks a suppressor (prefers LMG / most ammo / can actually hit) while a flanker moves; covers reloaders; morale break → rally (disciplined), scatter (aggressive), flee (cautious); splits search points around the last known position; bounding overwatch when investigating and searching | ai/Squad.js |
| Perception | vision cone, distance, light, posture, movement, muzzle flashes at night, faster re-acquisition of a just-seen enemy; dead teammates spotted within 30 m raise the alarm | AIAgent._perceive |
| Sound | gunshots (weapon noise × suppressor), footsteps (player and AI), doors, glass, shouted callouts, death cries; walls/terrain cut the effective radius (gunshots ×0.55, voices ×0.4, steps ×0.3) and blur the heard position | AIManager.emitSound |
| Reacting to noise | hostile fire within 150 m = contact (cover first); unknown gunfire = investigate (doctrine style); survivors move away; guards watch from a defensive spot instead of leaving their area | AIAgent.hear / investigate |
| Cover | candidates on the far face and corners of real colliders and around trees/rocks/hay; must hide a crouched body from the main threat, needs a peek (stand up or lean out) that can see/hit the threat; penalised if other threats see it, if reaching it crosses the enemy's view, or if a teammate is already there; bushes only as concealment of last resort | AIAgent._findCover |
| Firing rules | only when facing the aim point (±0.2 rad), with clear line of fire, no teammate along the bullet path (including beyond the target), not sprinting, within the weapon's effective range, and not into the lip of its own cover | AIAgent._combatTick |
| Suppression | at the last known position when the enemy is hidden, only with ammunition to spare and from a spot whose rounds land near the enemy | AIAgent._combatTick / canSuppress |
| Flanking | flank point ~90° around the enemy ending in cover; path cost avoids cells the enemy can see; a route that is mostly exposed is refused | AIAgent.orderFlank, NavGrid (threat cost) |
| Search | last known position, predicted point from last velocity, nearby corners; threat-aware approach, crouch-walk near the LKP; timeout per doctrine | AIAgent._searchThink, Squad.planSearch |
| Ammunition | reload in cover when possible, tactical reloads when hidden, sidearm switch, scavenge bodies for ammo or a loaded gun, disengage when empty | AIAgent._usable, _seekAmmo, _takeFrom |
| Morale | wounds, casualties, bodies, incoming fire (rate-limited); recovers when not under fire; cornered agents (enemy < 14 m, visible) fight instead of fleeing; 25 s hysteresis on retreats | AIAgent / Squad._morale |
| Movement robustness | path end short of the goal = failure; failed goals blacklisted 20 s; stuck: side-step → finer re-path → give up; agents moved without collision far away are pushed out of geometry when they come close | AIAgent._progressCheck, _moveFailed, _unembed |

**Fixed during firefight testing** (all found in the simulator's per-agent timelines): contacts known only by
sound counted as "lost long ago" so squads went idle; survivors re-planned hiding on every gunshot; morale
collapsed from passing bullets, causing retreat/re-engage loops in the open; flanks ran across open fields in
full view; cover spots next to walls snapped the path goal onto the agent's own cell, so it "arrived" without
moving and never reloaded; a guard crouched in the open for 27 s while being shot by someone he couldn't see;
leaning out to peek counted as leaving cover (cover-move/engage oscillation); squad fall-back orders made
agents turn their back on enemies at 10 m; shots fired with teammates beyond the target; crouched peeks
firing into the cover lip; raiders firing shotguns at 60 m; guards walking straight into an attacker
while "investigating" his gunfire; mixed-faction world-event squads (raiders and survivors in one squad
shooting each other); suppressor-fitted player weapons were as loud to the AI as unsuppressed ones; AI
`firedRecently` was always true after the first shot; squad radio used wall-clock timers.

## Known bugs / rough edges
* AI does not use grenades, does not go prone and does not climb stairs to upper floors.
* AI hearing has no speed-of-sound delay (the player's audio does).
* In dense areas (Millbrook) many cover candidates behind fences are unreachable; they fail fast and are blacklisted, which can delay a cover move by a second or two.
* Disciplined squads beat equal-sized raider gangs in nearly every simulated fight (better armour, accuracy and cover use); this is intended but not tuned against player feedback.
* At very low frame rates (<5 fps) the simulation runs slower than real time (dt clamped to 50 ms).
* AI can snag on furniture indoors; stuck detection drops the path and re-plans after ~4.5 s.
* Software-rendered browsers (no GPU) run at ~1 fps; the game is not playable there.
* Grass is alpha-tested cards; at grazing angles individual cards can read as flat strips.
* Buildings are still procedural boxes underneath the dressing; there are no curved or organic architectural forms.
* Eye adaptation is a simple two-state exposure blend (indoors/outdoors), not a luminance histogram.

## Next tasks (priority order)
1. Persist POI door states and corpses.
2. Multi-floor navigation for AI (stairs links in NavGrid).
3. Fractures/infection medical layer.
4. Music score (synthesised, adaptive to combat state).
5. Gamepad support.

## Test results

### Run of 2026-11-04, after the tactical AI pass (cloud container, Node + headless Chrome with SwiftShader, 960×540, "Low")

**Unit tests** (`npm test`): **47 / 47 pass** (re-run after the Chromebook/floor/spawn changes: 47 / 47; browser stages new-game and respawn pass; after the evening bug sweep: 48 / 48) — the 39 earlier tests plus 8 in `tests/unit/ai_sim.test.js`:
six simulated firefights (field skirmish, village skirmish, garrison defence, distant gunfire, ammunition
starvation, breaking contact) asserting no stuck agents, no agents inside geometry, no shots while facing
away, no negative ammunition, at most one friendly hit, cover use, suppression/flanking/cover-for-reload
occurring, guards staying within their leash, survivors not approaching gunfire, finite ammunition; plus
sound occlusion and game-time radio delays.

**Firefight sweep** (`npm run test:sim -- --seeds=8`, 7 scenarios × 8 seeds = 56 fights, 7,546 AI shots):
0 stuck agents, 0 agents inside geometry, 0 shots fired while facing away, 0 ammunition violations,
2 friendly hits in total, 1.2 % of shots clipping nearby cover. Share of combat time in cover: 41 % open
farmland, 45 % village, 80 % garrison, 72 % night. Disciplined VSF squads won all 16 squad-vs-squad fights
against Iron Wolves gangs (losing 0–2 soldiers). Distant gunfire 170 m away: raiders closed to 1–11 m,
soldiers to 8–38 m (spreading up to ~100 m apart while searching), survivors never came closer.

**Browser playtest** (`npm run test:e2e`): 12 / 13 stages passed in the full run with 0 console errors; the
ai-combat stage timed out waiting for 8 game-seconds at software-rendering speed (it had also timed out once
before the AI rework). The stage now waits for the AI to react instead; rerun of new-game → weapons →
ai-combat → kill-ai passed 4/4: the raiders went into combat (one advancing, one flanking) while the cautious
Millbrook survivors kept scavenging. Peak AI time per frame in the browser was 72 ms (previous runs 131–156 ms).

### Earlier run: 2026-10-29, after the visual upgrade (cloud container, headless Chrome with SwiftShader software WebGL, 960×540, "Low" preset)

**Production build:** `npm run build` succeeds.

**Unit tests** (`npm test`): **39 / 39 pass** — the 33 original tests plus 6 in `tests/unit/visuals.test.js`
(every POI layout builds without errors, Millbrook church and yards, 4-channel splat, ground cover types,
vegetation triangle budgets, and vehicle spawns clear of props).

**Automated browser playtest** (`npm run test:e2e`), 0 console errors:
* Full run: 12 / 13 stages pass — new game, look-around, Millbrook, movement/collision, weapons,
  AI combat (Iron Wolves hear gunfire and switch to combat), kill AI/corpses, inventory/map/crafting UI,
  save/load, Northwatch, vehicle (pickup reaches 8.8 m/s, fuel consumed), night/rain/dusk.
* base-building failed in that run because its test spot sat on a 3 m build-cell boundary beside a bank
  (2.8 m of height across the cell); which cell got picked depended on float rounding. The test now builds on flat
  ground, and a rerun of new-game → inventory → base-building → save-load passed (6 planks consumed,
  foundation + wall placed, identical after reload).

Regressions found by the playtest and fixed: a new farmstead water trough blocked the parked pickup
(vehicle stage failed), and the ranger-station utility vehicle (older bug) was parked on the perimeter
fence. The new unit test guards all vehicle spawns.

Performance note from the same runs: the spawn view on Low draws about 0.7–0.9 M triangles (shadow pass
included). To keep Low affordable, full-detail trees are limited to the player's own chunk on that preset and
rock meshes were simplified. Real-GPU frame rates were not measured.

**What was NOT tested here:** real-GPU frame rates (the container has no GPU — software rendering runs at
roughly 1–10 fps, so smoothness and feel could not be judged), audio output (no sound device), real mouse
pointer-lock input, and long play sessions. Those need a manual pass on a desktop browser.

### Manual test checklist (for a desktop run)
1. New game → walk into Millbrook, loot the marked cupboard → VK-9 + 9 mm.
2. Fire, reload, switch fire mode, aim down sights; check recoil and sound.
3. Engage Iron Wolves NE of Millbrook; take cover; get wounded; bandage.
4. Loot a body; drag items between body and inventory; confirm no duplication.
5. Build foundation, 3 walls, door, crate; store items; save; reload; verify.
6. Night with flashlight; rain; drive a vehicle and refuel it.
7. Settings: change FOV, sensitivity, shadows, volumes; confirm effect immediately.
