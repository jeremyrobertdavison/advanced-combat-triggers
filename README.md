# Advanced Combat Triggers

**Advanced Combat Triggers** is a Foundry Virtual Tabletop module that reacts to dramatic changes in player awareness.

It can detect when a player newly perceives a hostile token and when a token becomes hostile while already visible to a player, then pause the game, start combat, or ask the GM what should happen.

## Features

- Detects **Hostile** tokens using Foundry's native token disposition.
- Uses the **player client's real Foundry visibility result** instead of the GM's omniscient view.
- Reacts when a hostile token becomes newly visible because of movement, doors/walls, lighting, token visibility, or other sight refreshes.
- Detects a dramatic **Friendly/Neutral → Hostile** disposition change.
- Does not immediately trigger an off-screen betrayal; the hostile remains armed until a player can actually perceive it.
- Uses one active GM as the authority for pause/combat actions, preventing multiple GMs or players from creating duplicate encounters.
- Tracks visibility across multiple players and re-arms only after all players lose sight of the hostile.
- Can automatically add active player-owned tokens on the scene to combat.
- Does **not** automatically roll initiative. The active system remains responsible for its normal initiative workflow.

## Default Behavior

The defaults are intentionally conservative:

| Event | Default response |
| --- | --- |
| A player newly sees a hostile token | Ask the GM |
| A visible token changes to Hostile | Pause the game, then ask the GM |
| A token changes to Hostile while no player can see it | Do nothing immediately; trigger when later seen |
| Another player sees a hostile that somebody already sees | No duplicate trigger |

The GM prompt provides three choices:

- **Start Combat**
- **Pause Only**
- **Ignore**

If the module paused specifically for a disposition-change prompt, choosing **Start Combat** or **Ignore** releases that temporary pause. Choosing **Pause Only** leaves the game paused.

## Compatibility

- Foundry Virtual Tabletop **v13**
- Verified for Foundry v13.351 (using the v13 public API)
- System-agnostic: no game-system dependency is required

The initial release intentionally declares Foundry v13 as its maximum supported generation. Later Foundry generations should be tested before the manifest compatibility range is expanded.

## Installation

### Foundry manifest URL

In Foundry VTT, open **Add-on Modules → Install Module**, paste the following Manifest URL, and install:

```text
https://github.com/jeremyrobertdavison/advanced-combat-triggers/releases/latest/download/module.json
```

Then enable **Advanced Combat Triggers** in the desired world.

### Manual installation

Download `advanced-combat-triggers.zip` from the latest GitHub Release, extract it into Foundry's `Data/modules/advanced-combat-triggers/` directory, restart Foundry if necessary, and enable the module in the world.

## Configuration

Open **Game Settings → Configure Settings → Module Settings → Advanced Combat Triggers**.

Available world settings:

- **Enable Advanced Combat Triggers** — master on/off switch.
- **Newly Seen Hostile Action** — Ask the GM, Pause the game, or Start combat.
- **Visible Token Becomes Hostile** — Pause then ask the GM, Ask the GM, Pause the game, or Start combat.
- **Add Player-Owned Tokens to Combat** — when combat starts, add tokens on the same scene that are owned by active non-GM players.
- **Debug Logging** — writes detailed diagnostics to the browser console.

## How Detection Works

Foundry already knows whether a token is visible from a player's perspective. Advanced Combat Triggers listens to Foundry's vision/visibility refresh cycle on each player client and tracks hostile-token visibility transitions.

A trigger is based on a transition such as:

```text
not visible → visible
```

rather than repeatedly firing while a hostile remains visible.

Player clients report awareness changes over the module socket. The first active GM, selected deterministically, is the authoritative client that decides whether to pause the game or create/start a combat encounter.

This architecture avoids using the GM's unrestricted canvas visibility as a substitute for player line-of-sight.

## Disposition Changes

Changing a visible token from Friendly or Neutral to Hostile is treated as its own trigger event.

Example:

1. The party is speaking to a Friendly NPC.
2. The GM changes the token's disposition to **Hostile**.
3. A player who can see that token reports the change.
4. By default, the game pauses and the GM receives the combat-trigger prompt.

If the NPC is off-screen when its disposition changes, no immediate prompt is shown. Once a player later perceives the now-hostile token, the normal newly-seen-hostile trigger fires.

## Combat Creation

When **Start Combat** is chosen, the module:

1. Finds or creates an active combat encounter for that scene.
2. Adds the triggering hostile token.
3. Optionally adds player-owned tokens belonging to active non-GM users on that scene.
4. Starts the combat encounter if it has not already started.

The module intentionally does not roll initiative because initiative rules vary by game system.

## Important Notes

### A player client must be present for player-perspective detection

The module deliberately uses connected player clients to determine what players can actually see. This prevents GM omniscience from creating false triggers, but it also means a GM testing alone will not receive player-vision triggers simply by moving around the map as the GM.

### Token disposition defines hostility

Version 1.0.0 considers a token hostile when its Foundry token disposition is set to **Hostile**. More advanced encounter-group or token-specific trigger flags may be added in future versions.

### Existing visibility is baselined

When a player loads or changes to a scene, already-visible hostile tokens are recorded as a baseline and do not immediately trigger. This prevents reconnecting or refreshing the browser from unexpectedly launching combat.

## Troubleshooting

If a trigger does not behave as expected:

1. Confirm the module is enabled in the world.
2. Confirm at least one non-GM player is connected and viewing the scene.
3. Confirm the player owns at least one non-hidden token on the scene.
4. Confirm the target token's disposition is **Hostile**.
5. Enable **Debug Logging** in the module settings.
6. Press **F12** and inspect the browser console for messages beginning with `advanced-combat-triggers |`.

When reporting an issue, include the Foundry version, game system/version, relevant vision/lighting details, and any console errors.

## Development

The module is written as a Foundry ES module and has no runtime dependencies.

Repository layout:

```text
advanced-combat-triggers/
├── module.json
├── scripts/
│   └── main.js
├── styles/
│   └── advanced-combat-triggers.css
├── lang/
│   └── en.json
└── .github/workflows/
    └── release.yml
```

### Creating a release

Before tagging a release:

1. Update `version` in `module.json`.
2. Update the version-specific `download` URL in `module.json`.
3. Update `CHANGELOG.md`.
4. Commit the changes.
5. Push a tag matching the version, for example `v1.0.0`.

The included GitHub Actions workflow packages `advanced-combat-triggers.zip` and publishes both the ZIP and `module.json` as GitHub Release assets.

## Contributing

Bug reports and pull requests are welcome. Please keep changes system-agnostic where possible and document any Foundry API assumptions that could affect compatibility.

## License

Advanced Combat Triggers is released under the [MIT License](LICENSE).

Foundry Virtual Tabletop is © Foundry Gaming LLC. This project is an independent community module and is not affiliated with or endorsed by Foundry Gaming LLC.
