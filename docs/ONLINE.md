# Online co-op: how it works and how to host it

## What "online" means in this version

One server runs one shared world. Everyone connected to it plays in the same Vesper:

| Shared (the server decides) | Your own (kept in your browser) |
|---|---|
| Every AI soldier, raider and survivor: where they are, what they see and hear, who they shoot | Your health, injuries, hunger, thirst |
| Gunfights: your shots are re-run on the server with the real ballistics, so AI react to them exactly as in single player | Your inventory, equipment, skills, map knowledge |
| Bodies and what is on them (two players cannot take the same item) | Containers in buildings (each player rolls their own loot) |
| Doors in buildings | Your base, base storage and bedroll |
| Time of day, weather, how each faction feels about players | Vehicles |
| Chat (press **Enter** in game) | |

Players cannot shoot each other unless the server is started with `PVP=1`.

Your online character is saved in your browser under its own save, separate from single-player
saves. It is saved automatically every few minutes, when you choose **Save Character** in the menu,
and when you leave the server. As with single-player saves, clearing site data or playing in a private
window loses it.

## Host it free on Render (about 10 minutes)

You need a GitHub account and a Render account (sign in to Render with GitHub).

1. **Put the code on GitHub.** Create an empty repository (for example `iron-veil`) and upload this
   project into it, everything except `node_modules/`, `dist/` and `dist-server/`.
2. **Create the server on Render.** On <https://dashboard.render.com> choose **New → Blueprint**,
   connect your GitHub account if asked, pick the `iron-veil` repository and click **Apply**.
   Render reads `render.yaml` from the repository and creates a free web service called `iron-veil`.
3. **Wait for the first build** (3–6 minutes). The service page shows *Live* when it is ready, and its
   address, something like `https://iron-veil.onrender.com` (Render adds letters if the name is taken).
4. **Play.** Open that address. It is the full game. Choose **Play Online**, leave the server address
   empty, type a name and click **Join**. Send the same address to your friends.

Every time you push a change to GitHub, Render rebuilds and restarts the server by itself.

### Linking it from Zite

Point your Zite site's **Play** button at the Render address (for example
`https://iron-veil.onrender.com`). The server serves the game itself, so players get the newest version
and the server address can stay empty.

If you keep hosting the game files somewhere else (Zite, itch.io, GitHub Pages), players can still join:
in **Play Online** they type the server address (`iron-veil.onrender.com`). You can pre-fill it with a link:
`…/index.html?server=iron-veil.onrender.com`; add `&join=1` to connect as soon as the panel opens.

### Free plan limits (Render)

* The free server **goes to sleep after 15 minutes with nobody connected**. The next player to join waits
  about a minute while it wakes up (the game shows "Waking the server up…").
* When it sleeps or restarts, the shared world resets: AI garrisons come back, bodies disappear, doors
  close, and the clock restarts at 07:30. Your character is not affected, because it is saved in your browser.
* Render's paid "Starter" plan keeps the server awake.

## Settings (environment variables on Render → your service → Environment)

| Variable | Default | Meaning |
|---|---|---|
| `PVP` | `0` | `1` lets players shoot each other |
| `MAX_PLAYERS` | `16` | players allowed at once |
| `MOTD` | empty | message shown to players when they join |
| `PORT` | set by Render | port the server listens on |

`GET /health` answers with the number of players, AI and the server's average tick time.

## Running a server on your own computer

```bash
npm install
npm run build:all     # builds the game (dist/) and the server (dist-server/)
npm start             # → http://localhost:8080
```

Other people on your network can join with your computer's address, for example `192.168.1.20:8080`.
To play over the internet from your computer you would have to open a port on your router; Render is easier.

## How it is built

* `server/index.js` — HTTP server for the game files, WebSocket endpoint `/ws`, `/health`.
* `server/GameServer.js` — connections, the message protocol, snapshots, shot relay, bodies, doors, chat.
* `server/HeadlessGame.js` — the world without a renderer: the same terrain, buildings, doors, tree and rock
  colliders, AI, ballistics, factions, clock and weather modules the browser uses, built only around players.
* `server/NetPlayer.js` — a connected player as the AI sees them; damage the AI deals is sent to that player.
* `src/net/NetClient.js` — the browser side: sends movement (15 per second) and shots, replays everyone
  else's shots, applies hits, mirrors bodies, doors, time, weather and chat.
* `src/net/RemoteActors.js` — AI and other players drawn from server snapshots (12 per second), smoothed
  by interpolating about 0.13 s behind the newest one.
* `src/net/protocol.js` — message format shared by both.

The server runs at 30 ticks per second. Each player receives only the people within 650 m and gunfire
within 1.1 km.

## Known limitations of this first online version

* **Movement is trusted from the browser** (speed is sanity-checked). It is built for playing with friends,
  not for strangers on a public server.
* No lag compensation: against a moving target the server may judge a close shot as a miss when your
  connection is slow.
* Containers, bases, base raids and vehicles are per player. Other players see you walking, not driving.
  Base raids and roaming world events (patrols, convoys, supply drops) are off on servers for now.
* Bridges are not in the server's world, so AI do not cross rivers on bridges.
* The shared world is not saved; it resets when the server restarts (see free plan limits).
