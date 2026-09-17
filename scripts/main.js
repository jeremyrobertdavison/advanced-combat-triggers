const MODULE_ID = "advanced-combat-triggers";
const SOCKET_NAME = `module.${MODULE_ID}`;
const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;

const localVisibility = new Map();
const gmVisibility = new Map();
const queuedTriggers = new Set();
let scanTimer = null;
let baselineReady = false;

Hooks.once("init", () => {
  registerSettings();
  console.log(`${MODULE_ID} | Initializing Advanced Combat Triggers`);
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET_NAME, onSocketMessage);

  // Small public API for troubleshooting and future integrations.
  globalThis.AdvancedCombatTriggers = {
    id: MODULE_ID,
    version: game.modules.get(MODULE_ID)?.version ?? "unknown",
    scan: () => scheduleVisibilityScan(0),
    isPrimaryGM
  };
});

Hooks.on("canvasReady", () => {
  localVisibility.clear();
  baselineReady = false;
  if (!game.user?.isGM) setTimeout(initializeVisibilityBaseline, 250);
});

Hooks.on("canvasTearDown", () => {
  localVisibility.clear();
  baselineReady = false;
});

Hooks.on("sightRefresh", () => scheduleVisibilityScan());
Hooks.on("visibilityRefresh", () => scheduleVisibilityScan());
Hooks.on("lightingRefresh", () => scheduleVisibilityScan());
Hooks.on("moveToken", () => scheduleVisibilityScan());
Hooks.on("stopToken", () => scheduleVisibilityScan());

Hooks.on("updateToken", (document, changed) => {
  if (!isEnabled()) return;

  const dispositionChanged = Object.prototype.hasOwnProperty.call(changed, "disposition");
  if (dispositionChanged) {
    if (changed.disposition === HOSTILE) {
      setTimeout(() => handleBecameHostile(document), 100);
    } else {
      clearLocalHostileState(document);
    }
  }

  // Hidden state, vision, position, elevation, and similar updates can all alter
  // practical visibility. Foundry will usually refresh sight itself, but this
  // makes the module resilient to system/module-driven token updates as well.
  scheduleVisibilityScan(125);
});

Hooks.on("createToken", () => scheduleVisibilityScan(125));
Hooks.on("deleteToken", document => clearLocalHostileState(document));

Hooks.on("userConnected", (user, connected) => {
  if (!connected && isPrimaryGM()) clearGMVisibilityForUser(user.id);
});

function registerSettings() {
  game.settings.register(MODULE_ID, "enabled", {
    name: "ACT.Settings.Enabled.Name",
    hint: "ACT.Settings.Enabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "seenAction", {
    name: "ACT.Settings.SeenAction.Name",
    hint: "ACT.Settings.SeenAction.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      prompt: "ACT.Settings.Actions.Prompt",
      pause: "ACT.Settings.Actions.Pause",
      combat: "ACT.Settings.Actions.Combat"
    },
    default: "prompt"
  });

  game.settings.register(MODULE_ID, "dispositionAction", {
    name: "ACT.Settings.DispositionAction.Name",
    hint: "ACT.Settings.DispositionAction.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "pause-prompt": "ACT.Settings.Actions.PausePrompt",
      prompt: "ACT.Settings.Actions.Prompt",
      pause: "ACT.Settings.Actions.Pause",
      combat: "ACT.Settings.Actions.Combat"
    },
    default: "pause-prompt"
  });

  game.settings.register(MODULE_ID, "includePlayerTokens", {
    name: "ACT.Settings.IncludePlayers.Name",
    hint: "ACT.Settings.IncludePlayers.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "debug", {
    name: "ACT.Settings.Debug.Name",
    hint: "ACT.Settings.Debug.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
}

function isEnabled() {
  return Boolean(game.settings?.get(MODULE_ID, "enabled"));
}

function debug(...args) {
  if (game.settings?.get(MODULE_ID, "debug")) {
    console.debug(`${MODULE_ID} |`, ...args);
  }
}

function scheduleVisibilityScan(delay = 75) {
  if (!game.ready || game.user?.isGM || !isEnabled()) return;
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scanVisibilityTransitions, delay);
}

function playerHasObserverToken() {
  if (!canvas?.ready) return false;
  return canvas.tokens.placeables.some(token => {
    if (token.document.hidden) return false;
    return Boolean(token.actor?.isOwner);
  });
}

function hostileTokensOnCanvas() {
  if (!canvas?.ready) return [];
  return canvas.tokens.placeables.filter(token => token.document.disposition === HOSTILE);
}

function initializeVisibilityBaseline() {
  if (!canvas?.ready || game.user?.isGM || !isEnabled()) return;

  localVisibility.clear();
  const visibleTokenIds = [];

  if (playerHasObserverToken()) {
    for (const token of hostileTokensOnCanvas()) {
      const visible = Boolean(token.isVisible);
      localVisibility.set(token.id, visible);
      if (visible) visibleTokenIds.push(token.id);
    }
  }

  baselineReady = true;
  emitSocket({
    type: "baseline",
    sceneId: canvas.scene.id,
    userId: game.user.id,
    visibleTokenIds
  });

  debug("Visibility baseline initialized", visibleTokenIds);
}

function scanVisibilityTransitions() {
  if (!canvas?.ready || game.user?.isGM || !isEnabled() || !baselineReady) return;

  const sceneId = canvas.scene.id;
  const currentHostiles = new Set();

  if (!playerHasObserverToken()) {
    for (const [tokenId, wasVisible] of localVisibility) {
      if (wasVisible) emitVisibility(sceneId, tokenId, false);
    }
    localVisibility.clear();
    return;
  }

  for (const token of hostileTokensOnCanvas()) {
    currentHostiles.add(token.id);
    const visible = Boolean(token.isVisible);
    const previous = localVisibility.get(token.id);

    if (previous === undefined) {
      localVisibility.set(token.id, visible);
      if (visible) emitVisibility(sceneId, token.id, true);
      continue;
    }

    if (visible !== previous) {
      localVisibility.set(token.id, visible);
      emitVisibility(sceneId, token.id, visible);
    }
  }

  // Tokens which ceased to be hostile, were deleted, or otherwise left the
  // canvas must also be cleared so a future sighting can re-arm the trigger.
  for (const [tokenId, wasVisible] of [...localVisibility.entries()]) {
    if (currentHostiles.has(tokenId)) continue;
    if (wasVisible) emitVisibility(sceneId, tokenId, false);
    localVisibility.delete(tokenId);
  }
}

function handleBecameHostile(document) {
  if (game.user?.isGM || !isEnabled() || !canvas?.ready) return;
  if (document.parent?.id !== canvas.scene.id) return;
  if (!playerHasObserverToken()) return;

  const token = canvas.tokens.get(document.id);
  if (!token) return;

  const visible = Boolean(token.isVisible);
  localVisibility.set(document.id, visible);

  emitSocket({
    type: "disposition-hostile",
    sceneId: canvas.scene.id,
    tokenId: document.id,
    userId: game.user.id,
    visible
  });

  debug("Disposition became hostile", document.name, { visible });
}

function clearLocalHostileState(document) {
  if (game.user?.isGM || !canvas?.ready) return;
  if (document.parent?.id !== canvas.scene.id) return;

  const wasVisible = localVisibility.get(document.id);
  if (wasVisible) emitVisibility(canvas.scene.id, document.id, false);
  localVisibility.delete(document.id);
}

function emitVisibility(sceneId, tokenId, visible) {
  emitSocket({
    type: "visibility",
    sceneId,
    tokenId,
    userId: game.user.id,
    visible
  });
}

function emitSocket(payload) {
  game.socket.emit(SOCKET_NAME, payload);
}

function onSocketMessage(payload) {
  if (!isPrimaryGM() || !isEnabled() || !payload || typeof payload !== "object") return;

  switch (payload.type) {
    case "baseline":
      receiveBaseline(payload);
      break;
    case "visibility":
      receiveVisibility(payload);
      break;
    case "disposition-hostile":
      receiveDispositionHostile(payload);
      break;
  }
}

function isPrimaryGM() {
  if (!game.user?.isGM) return false;
  const activeGMs = game.users
    .filter(user => user.active && user.isGM)
    .sort((a, b) => a.id.localeCompare(b.id));
  return activeGMs[0]?.id === game.user.id;
}

function visibilityKey(sceneId, tokenId) {
  return `${sceneId}:${tokenId}`;
}

function receiveBaseline({ sceneId, userId, visibleTokenIds = [] }) {
  if (!validUserScene(userId, sceneId)) return;

  clearGMVisibilityForUser(userId, sceneId);
  for (const tokenId of visibleTokenIds) {
    const token = getSceneToken(sceneId, tokenId);
    if (!token || token.disposition !== HOSTILE) continue;
    const key = visibilityKey(sceneId, tokenId);
    const viewers = gmVisibility.get(key) ?? new Set();
    viewers.add(userId);
    gmVisibility.set(key, viewers);
  }

  debug("Received visibility baseline", { sceneId, userId, visibleTokenIds });
}

function receiveVisibility({ sceneId, tokenId, userId, visible }) {
  if (!validUserScene(userId, sceneId)) return;

  const token = getSceneToken(sceneId, tokenId);
  if (!token) return;

  const key = visibilityKey(sceneId, tokenId);
  const viewers = gmVisibility.get(key) ?? new Set();
  const hadAnyViewer = viewers.size > 0;

  if (visible) viewers.add(userId);
  else viewers.delete(userId);

  if (viewers.size) gmVisibility.set(key, viewers);
  else gmVisibility.delete(key);

  if (visible && !hadAnyViewer && token.disposition === HOSTILE) {
    queueTrigger({ sceneId, tokenId, userId, reason: "seen" });
  }
}

function receiveDispositionHostile({ sceneId, tokenId, userId, visible }) {
  if (!validUserScene(userId, sceneId)) return;

  const token = getSceneToken(sceneId, tokenId);
  if (!token || token.disposition !== HOSTILE) return;

  const key = visibilityKey(sceneId, tokenId);
  const viewers = gmVisibility.get(key) ?? new Set();
  const hadAnyViewer = viewers.size > 0;

  if (visible) {
    viewers.add(userId);
    gmVisibility.set(key, viewers);
    if (!hadAnyViewer) queueTrigger({ sceneId, tokenId, userId, reason: "disposition" });
  } else {
    viewers.delete(userId);
    if (viewers.size) gmVisibility.set(key, viewers);
    else gmVisibility.delete(key);
  }
}

function validUserScene(userId, sceneId) {
  const user = game.users.get(userId);
  const scene = game.scenes.get(sceneId);
  return Boolean(user && !user.isGM && user.active && scene);
}

function clearGMVisibilityForUser(userId, sceneId = null) {
  for (const [key, viewers] of [...gmVisibility.entries()]) {
    if (sceneId && !key.startsWith(`${sceneId}:`)) continue;
    viewers.delete(userId);
    if (!viewers.size) gmVisibility.delete(key);
  }
}

function getSceneToken(sceneId, tokenId) {
  return game.scenes.get(sceneId)?.tokens.get(tokenId) ?? null;
}

function queueTrigger(trigger) {
  const key = `${trigger.reason}:${trigger.sceneId}:${trigger.tokenId}`;
  if (queuedTriggers.has(key)) return;

  queuedTriggers.add(key);
  Promise.resolve()
    .then(() => handleTrigger(trigger))
    .catch(error => {
      console.error(`${MODULE_ID} | Trigger handling failed`, error);
      ui.notifications.error("Advanced Combat Triggers encountered an error. Check the browser console (F12).");
    })
    .finally(() => setTimeout(() => queuedTriggers.delete(key), 1500));
}

async function handleTrigger({ sceneId, tokenId, userId, reason }) {
  if (!isPrimaryGM() || !isEnabled()) return;

  const scene = game.scenes.get(sceneId);
  const token = scene?.tokens.get(tokenId);
  const user = game.users.get(userId);
  if (!scene || !token || token.disposition !== HOSTILE) return;

  const actionSetting = reason === "disposition"
    ? game.settings.get(MODULE_ID, "dispositionAction")
    : game.settings.get(MODULE_ID, "seenAction");

  debug("Handling trigger", { scene: scene.name, token: token.name, user: user?.name, reason, actionSetting });

  if (actionSetting === "pause") {
    pauseGame(true);
    ui.notifications.warn(`${token.name}: combat trigger paused the game.`);
    return;
  }

  if (actionSetting === "combat") {
    await startCombatForTrigger(scene, token);
    return;
  }

  let pausedByModule = false;
  if (actionSetting === "pause-prompt" && !game.paused) {
    pauseGame(true);
    pausedByModule = true;
  }

  const choice = await promptGM({ scene, token, user, reason });

  if (choice === "combat") {
    await startCombatForTrigger(scene, token);
    if (pausedByModule) pauseGame(false);
  } else if (choice === "pause") {
    pauseGame(true);
  } else if (pausedByModule) {
    pauseGame(false);
  }
}

async function promptGM({ scene, token, user, reason }) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const observerName = user?.name ?? "A player";
  const reasonText = reason === "disposition"
    ? `${escapeHTML(token.name)} became hostile while visible to ${escapeHTML(observerName)}.`
    : `${escapeHTML(observerName)} newly perceived hostile token ${escapeHTML(token.name)}.`;

  return DialogV2.wait({
    window: { title: "Advanced Combat Trigger" },
    modal: false,
    rejectClose: false,
    content: `
      <div class="advanced-combat-triggers-dialog">
        <p><strong>${reasonText}</strong></p>
        <p>Scene: ${escapeHTML(scene.name)}</p>
        <p>Choose how Foundry should respond.</p>
      </div>
    `,
    buttons: [
      {
        action: "combat",
        label: "Start Combat",
        icon: "fa-solid fa-swords",
        default: true
      },
      {
        action: "pause",
        label: "Pause Only",
        icon: "fa-solid fa-pause"
      },
      {
        action: "ignore",
        label: "Ignore",
        icon: "fa-solid fa-xmark"
      }
    ]
  });
}

async function startCombatForTrigger(scene, hostileToken) {
  const tokens = [hostileToken];

  if (game.settings.get(MODULE_ID, "includePlayerTokens")) {
    const activePlayers = game.users.filter(user => user.active && !user.isGM);
    for (const token of scene.tokens) {
      if (token.id === hostileToken.id || !token.actor) continue;
      const ownedByActivePlayer = activePlayers.some(user =>
        token.actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
      );
      if (ownedByActivePlayer) tokens.push(token);
    }
  }

  let combat = game.combats.find(candidate => {
    const candidateSceneId = candidate.scene?.id ?? candidate._source?.scene;
    return candidateSceneId === scene.id && candidate.active;
  });

  if (!combat) {
    combat = await CONFIG.Combat.documentClass.create({
      scene: scene.id,
      active: true
    });
  }

  if (!combat) throw new Error("Unable to create or locate a combat encounter.");

  const uniqueTokens = [...new Map(tokens.map(token => [token.id, token])).values()];
  const notInCombat = uniqueTokens.filter(token => !combat.getCombatantsByToken(token.id).length);

  if (notInCombat.length) {
    await CONFIG.Token.documentClass.createCombatants(notInCombat, { combat });
  }

  if (!combat.started) await combat.startCombat();

  ui.notifications.info(`Combat started: ${hostileToken.name}`);
  debug("Combat started", { combatId: combat.id, tokenIds: uniqueTokens.map(token => token.id) });
}

function pauseGame(paused) {
  if (!game.user?.isGM || game.paused === paused) return;
  game.togglePause(paused, { broadcast: true });
}

function escapeHTML(value) {
  const element = document.createElement("div");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}
