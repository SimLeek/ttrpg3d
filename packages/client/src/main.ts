// Entry point: wires up the router between the worlds lobby page (default
// route) and the actual 3D game view (started once a world is picked).
// See lobby.ts and game.ts for what each view actually does.

import Navigo from "navigo";
import { mountLobby, type Account, type WorldRecord } from "./lobby.js";
import { startGame, type RunningGame } from "./game.js";
import { fetchAccounts, fetchWorlds, ACCOUNT_STORAGE_KEY } from "./api.js";

const wsUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL ?? "ws://localhost:2567";
const httpUrl = wsUrl.replace(/^ws/, "http");

const router = new Navigo("/");
const lobbyEl = document.getElementById("lobby")!;

// Navigo resolves routes from the URL alone; the world/account the lobby's
// "Play" click picked travels through this instead of being re-fetched or
// re-encoded into the URL -- fine for the normal lobby -> game handoff, but
// it's empty on a direct URL load or a page refresh while already in a
// game (both reproduced live: refreshing mid-game bounced to the lobby
// instead of staying in the game). The /world/:id handler below falls back
// to reconstructing the same state from localStorage + a server fetch in
// that case, rather than giving up and going to the lobby.
let pendingPlay: { world: WorldRecord; account: Account } | null = null;

let runningGame: RunningGame | null = null;

function stopRunningGameIfAny(): void {
  if (runningGame) {
    runningGame.stop();
    runningGame = null;
  }
}

router.on("/", () => {
  // Leaving the game route (including via the browser back button, which
  // Navigo resolves the same as any other navigation) previously left
  // noa's canvas running full-screen on top of the lobby -- reproduced
  // live, "stays in the world scene" until a hard refresh. Tear it down
  // explicitly instead.
  stopRunningGameIfAny();
  lobbyEl.hidden = false;
  mountLobby(lobbyEl, httpUrl, (world, account) => {
    pendingPlay = { world, account };
    router.navigate(`/world/${world.id}`);
  });
});

router.on("/world/:id", (match) => {
  const worldId = match?.data?.id;
  if (!worldId) {
    router.navigate("/");
    return;
  }

  if (pendingPlay && pendingPlay.world.id === worldId) {
    lobbyEl.hidden = true;
    runningGame = startGame(worldId, pendingPlay.world.name, wsUrl, pendingPlay.account.displayName, pendingPlay.account.id);
    return;
  }

  // Direct URL load or a refresh while already in-game: pendingPlay is
  // gone, but the account id is still in localStorage and the world id is
  // right there in the URL -- reconstruct instead of bouncing to the
  // lobby and losing the session.
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
    const worlds = await fetchWorlds(httpUrl, account.id);
    const world = worlds.find((w) => w.id === worldId);
    if (!world) {
      // Valid account, but this world isn't (or no longer is) visible to
      // it -- genuinely can't reconstruct, lobby is the right fallback.
      router.navigate("/");
      return;
    }
    pendingPlay = { world, account };
    lobbyEl.hidden = true;
    runningGame = startGame(world.id, world.name, wsUrl, account.displayName, account.id);
  })();
});

router.resolve();
