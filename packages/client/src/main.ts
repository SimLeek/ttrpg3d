// Entry point: wires up the router between the games lobby page (default
// route) and the actual 3D game view (started once a game is picked). See
// lobby.ts and game.ts for what each view actually does.
//
// Games-and-world-generators PR: routing is now keyed by GAME id
// (`/game/:id`, was `/world/:id`) -- a game's current world (roll20
// "page") is resolved at launch time, and `launchGame`'s `onSwitchWorld`
// callback (passed into game.ts/net.ts, triggered by the in-game
// page-management panel) restarts the SAME game session against a
// different world without touching the route or going back through the
// lobby -- it reuses the exact same stop()+startGame() cycle this file
// already used for the lobby->game handoff.

import Navigo from "navigo";
import { mountLobby, type Account, type GameRecord, type WorldRecord } from "./lobby.js";
import { startGame, type RunningGame } from "./game.js";
import { fetchAccounts, fetchGames, fetchWorldsForGame, fetchGameChat, ACCOUNT_STORAGE_KEY, CHARACTER_STORAGE_KEY } from "./api.js";
import { connectChat, type ChatConnection } from "./chatNet.js";
import { mountChatPanel, type ChatPanelController } from "./chatPanel.js";
import { mountQuickActionsPanel, type QuickActionsPanelController } from "./quickActionsPanel.js";
import { mountPartyListPanel, type PartyListPanelController } from "./partyListPanel.js";

const wsUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL ?? "ws://localhost:2567";
const httpUrl = wsUrl.replace(/^ws/, "http");

const router = new Navigo("/");
const lobbyEl = document.getElementById("lobby")!;

// Navigo resolves routes from the URL alone; the game/world/account the
// lobby's "Play" click picked travels through this instead of being
// re-fetched or re-encoded into the URL -- fine for the normal lobby ->
// game handoff, but it's empty on a direct URL load or a page refresh
// while already in a game (both reproduced live: refreshing mid-game
// bounced to the lobby instead of staying in the game). The /game/:id
// handler below falls back to reconstructing the same state from
// localStorage + a server fetch in that case, rather than giving up and
// going to the lobby.
let pendingPlay: { game: GameRecord; world: WorldRecord; account: Account; characterId: string | null } | null = null;

let runningGame: RunningGame | null = null;

function stopRunningGameIfAny(): void {
  if (runningGame) {
    runningGame.stop();
    runningGame = null;
  }
}

function launchGame(game: GameRecord, worldId: string, worldName: string, account: Account, characterId: string | null): void {
  lobbyEl.hidden = true;
  runningGame = startGame(game.id, worldId, worldName, wsUrl, httpUrl, account.displayName, account.id, characterId, (newWorldId, newWorldName) => {
    // Page-management panel's "switch" action -- same proven teardown/
    // setup this file already uses for the lobby->game handoff, just
    // without navigating the route or re-showing the lobby in between.
    // Deliberately only ever calls launchGame (not enterGame below) --
    // chat must NOT reconnect/flicker on a page switch, only on
    // actually entering/leaving a game.
    stopRunningGameIfAny();
    launchGame(game, newWorldId, newWorldName, account, characterId);
  });
}

// Chat + quick-actions + party-list are all scoped to the whole GAME,
// not a single World/page -- they must survive launchGame's own
// teardown/rebuild cycle above (every page switch), so this is a
// SEPARATE persistent reference, opened/closed independently of
// runningGame. See docs/ROADMAP.md's MVP goal section (items 0 and 3)
// and chatNet.ts/chatPanel.ts/quickActionsPanel.ts/partyListPanel.ts's
// own headers for the full reasoning (the left mode-select panel is
// NOT here -- it's per-page, mounted inside game.ts's startGame()
// instead, same lifecycle as hotbar.ts, since pointer-lock is
// inherently a per-noa-session concept).
let runningChat: {
  connection: ChatConnection;
  chatPanel: ChatPanelController;
  quickActionsPanel: QuickActionsPanelController;
  partyListPanel: PartyListPanelController;
  containers: HTMLDivElement[];
  gameId: string;
} | null = null;

function stopRunningChatIfAny(): void {
  if (runningChat) {
    runningChat.chatPanel.destroy();
    runningChat.quickActionsPanel.destroy();
    runningChat.partyListPanel.destroy();
    for (const container of runningChat.containers) container.remove();
    runningChat.connection.leave();
    runningChat = null;
  }
}

/** Connects/mounts chat + quick-actions + party-list for `game` if not already connected to this exact game (a page switch calls launchGame directly and never reaches here, so this only (re)connects on a genuine game entry or a switch between two different games), then runs the normal launchGame flow. */
function enterGame(game: GameRecord, worldId: string, worldName: string, account: Account, characterId: string | null): void {
  if (!runningChat || runningChat.gameId !== game.id) {
    stopRunningChatIfAny();
    const chatContainer = document.createElement("div");
    const quickActionsContainer = document.createElement("div");
    const partyListContainer = document.createElement("div");
    document.body.appendChild(chatContainer);
    document.body.appendChild(quickActionsContainer);
    document.body.appendChild(partyListContainer);
    void (async () => {
      const [connection, history] = await Promise.all([connectChat(wsUrl, game.id, account.displayName, account.id, characterId), fetchGameChat(httpUrl, game.id)]);
      const chatPanel = mountChatPanel(chatContainer, {
        initialMessages: history,
        onSend: (text) => connection.send(text),
        onFocusChange: (focused) => runningGame?.setPointerLock(!focused),
      });
      connection.onMessage((message) => chatPanel.addMessage(message));
      connection.onError((reason) => chatPanel.showError(reason));

      const quickActionsPanel = mountQuickActionsPanel(quickActionsContainer);
      const partyListPanel = mountPartyListPanel(partyListContainer, {
        initialPlayers: [],
        onPresenceChange: connection.onPresenceChange,
      });

      runningChat = { connection, chatPanel, quickActionsPanel, partyListPanel, containers: [chatContainer, quickActionsContainer, partyListContainer], gameId: game.id };
    })();
  }
  launchGame(game, worldId, worldName, account, characterId);
}

router.on("/", () => {
  // Leaving the game route (including via the browser back button, which
  // Navigo resolves the same as any other navigation) previously left
  // noa's canvas running full-screen on top of the lobby -- reproduced
  // live, "stays in the world scene" until a hard refresh. Tear it down
  // explicitly instead.
  stopRunningGameIfAny();
  stopRunningChatIfAny();
  lobbyEl.hidden = false;
  mountLobby(lobbyEl, httpUrl, (game, world, account, characterId) => {
    pendingPlay = { game, world, account, characterId };
    router.navigate(`/game/${game.id}`);
  });
});

router.on("/game/:id", (match) => {
  const gameId = match?.data?.id;
  if (!gameId) {
    router.navigate("/");
    return;
  }

  if (pendingPlay && pendingPlay.game.id === gameId) {
    enterGame(pendingPlay.game, pendingPlay.world.id, pendingPlay.world.name, pendingPlay.account, pendingPlay.characterId);
    return;
  }

  // Direct URL load or a refresh while already in-game: pendingPlay is
  // gone, but the account id is still in localStorage and the game id is
  // right there in the URL -- reconstruct instead of bouncing to the
  // lobby and losing the session. Resolves the game's FIRST world (same
  // as lobby.ts's own Play-click resolution) -- if the player had
  // switched to a different page before refreshing, this loses that in-
  // session choice and returns to the first page, a real but minor
  // limitation (no server-side "which page was this client last on"
  // tracking exists, matching this PR's explicit no-cross-client-sync
  // scope).
  void (async () => {
    const storedAccountId = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!storedAccountId) {
      router.navigate("/");
      return;
    }
    const accounts = await fetchAccounts(httpUrl);
    const account = accounts.find((a) => a.id === storedAccountId);
    if (!account) {
      router.navigate("/");
      return;
    }
    const games = await fetchGames(httpUrl, account.id);
    const game = games.find((g) => g.id === gameId);
    if (!game) {
      // Valid account, but this game isn't (or no longer is) visible to
      // it -- genuinely can't reconstruct, lobby is the right fallback.
      router.navigate("/");
      return;
    }
    const worlds = await fetchWorldsForGame(httpUrl, game.id);
    const world = worlds[0];
    if (!world) {
      router.navigate("/");
      return;
    }
    const characterId = localStorage.getItem(CHARACTER_STORAGE_KEY);
    pendingPlay = { game, world, account, characterId };
    enterGame(game, world.id, world.name, account, characterId);
  })();
});

router.resolve();
