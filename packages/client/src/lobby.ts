// Games lobby page: account switcher + fuzzy-searchable GAMES list (the
// roll20-"campaign" concept). Plain DOM/TS, no UI framework -- see the
// "Worlds lobby page" section of the architecture plan for why (a filtered
// list and an account dropdown don't need one; navigo alone covers the
// "add a router now" preference).
//
// Games-and-world-generators PR: this used to list/create WORLDS directly
// -- worlds (roll20 "pages") now live INSIDE a game, created/switched from
// the in-game page-management panel (pageManager.ts) once a session is
// active, not from here. Picking a game here resolves its first world
// (every game is guaranteed at least one -- see the "Create game" handler
// below, which auto-creates a starter DEFAULT_GENERATOR_ID world the same
// way store.ts's ensureSeedData() does for the seeded games) and enters it.

import { fuzzyMatch, DEFAULT_GENERATOR_ID } from "@ttrpg3d/shared";
import {
  fetchAccounts,
  fetchGames,
  fetchWorldsForGame,
  fetchCharactersForAccount,
  createAccount,
  createGame,
  createWorldInGame,
  createCharacter,
  ACCOUNT_STORAGE_KEY,
  CHARACTER_STORAGE_KEY,
  type Account,
  type GameRecord,
  type WorldRecord,
  type CharacterRecord,
} from "./api.js";

export type { Account, GameRecord, WorldRecord, CharacterRecord };

/** MVP goal items 1-2 (docs/ROADMAP.md) -- a random-ish default so "Create character" doesn't require picking a color first; the color input below lets the player change it before or after. Exported -- characters.ts's own "+ Create new character" control (MVP goal item 4 follow-up) reuses this exact default instead of inventing a second one. */
export function randomCharacterColor(): [number, number, number] {
  return [Math.random(), Math.random(), Math.random()];
}

/** Exported -- characters.ts's bar-color picker reuses this exact conversion instead of inventing a second one (this project's one existing color convention: 0-1 floats everywhere except at an `<input type="color">` boundary). */
export function colorToHex([r, g, b]: [number, number, number]): string {
  const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToColor(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

export function mountLobby(
  container: HTMLElement,
  httpUrl: string,
  onPlay: (game: GameRecord, world: WorldRecord, account: Account, characterId: string | null) => void,
  // MVP goal item 4 (docs/ROADMAP.md), slice 1 -- the one new piece of
  // UI chrome needed to actually reach the new standalone characters
  // page. Threaded as a callback, same established pattern onPlay
  // above already uses (main.ts owns router.navigate, not this file).
  onViewCharacters: () => void,
): void {
  container.innerHTML = `
    <style>
      .lobby { max-width: 640px; margin: 48px auto; font-family: system-ui, sans-serif; color: #eee; max-height: calc(100vh - 96px); display: flex; flex-direction: column; }
      .lobby h1 { font-size: 1.5rem; flex: none; }
      .lobby .row { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; flex: none; }
      .lobby input, .lobby select, .lobby button { font-size: 1rem; padding: 6px 10px; }
      /* Real bug found live: index.html sets html/body to overflow:
         hidden + height:100% (needed so the full-screen noa canvas never
         grows document scrollbars) -- that also blocked the lobby page's
         own document-level scroll, so a games list longer than one
         screen was simply unreachable past what fit, with fuzzy search as
         the only way to narrow down to an otherwise-unreachable game.
         Fixed by making the list itself (not the whole page) the
         scrollable region -- .lobby's own max-height + flex column
         above keeps the account/search controls always visible while
         only #games-list scrolls. */
      .lobby ul { list-style: none; padding: 0; margin: 0; overflow-y: auto; flex: 1 1 auto; min-height: 0; }
      .lobby li { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; margin-bottom: 6px; background: #2a2a2a; border-radius: 6px; }
      .lobby li .game-meta { color: #999; font-size: 0.85rem; margin-left: 8px; }
      .lobby .play-btn { cursor: pointer; }
      .lobby .empty { color: #888; padding: 10px 0; }
    </style>
    <div class="lobby">
      <div class="row">
        <h1 style="flex:1; margin:0;">ttrpg3d -- Games</h1>
        <button id="view-characters-btn" type="button">My Characters</button>
      </div>
      <div class="row">
        <label for="account-select">Account:</label>
        <select id="account-select"></select>
        <input id="new-account-name" placeholder="New account display name" />
        <button id="create-account-btn" type="button">Create account</button>
      </div>
      <div class="row">
        <label for="character-select">Character:</label>
        <select id="character-select"></select>
        <input id="new-character-name" placeholder="New character name" />
        <input id="new-character-color" type="color" title="Token color" />
        <button id="create-character-btn" type="button">Create character</button>
      </div>
      <div class="row">
        <input id="new-game-name" placeholder="New game name" style="flex:1" />
        <button id="create-game-btn" type="button">Create game</button>
      </div>
      <div class="row">
        <input id="search" placeholder="Search games..." style="flex:1" />
      </div>
      <ul id="games-list"></ul>
    </div>
  `;

  const viewCharactersBtn = container.querySelector<HTMLButtonElement>("#view-characters-btn")!;
  viewCharactersBtn.addEventListener("click", onViewCharacters);

  const select = container.querySelector<HTMLSelectElement>("#account-select")!;
  const newAccountNameInput = container.querySelector<HTMLInputElement>("#new-account-name")!;
  const createAccountBtn = container.querySelector<HTMLButtonElement>("#create-account-btn")!;
  const characterSelect = container.querySelector<HTMLSelectElement>("#character-select")!;
  const newCharacterNameInput = container.querySelector<HTMLInputElement>("#new-character-name")!;
  const newCharacterColorInput = container.querySelector<HTMLInputElement>("#new-character-color")!;
  const createCharacterBtn = container.querySelector<HTMLButtonElement>("#create-character-btn")!;
  const newGameNameInput = container.querySelector<HTMLInputElement>("#new-game-name")!;
  const createGameBtn = container.querySelector<HTMLButtonElement>("#create-game-btn")!;
  const searchInput = container.querySelector<HTMLInputElement>("#search")!;
  const listEl = container.querySelector<HTMLUListElement>("#games-list")!;

  newCharacterColorInput.value = colorToHex(randomCharacterColor());

  let accounts: Account[] = [];
  let games: GameRecord[] = [];
  let characters: CharacterRecord[] = [];
  let selectedAccountId: string | null = localStorage.getItem(ACCOUNT_STORAGE_KEY);
  // Not scoped per-account in storage -- a minimal MVP simplification (full
  // multi-character-per-account selection UX is downstream of MVP goal
  // item 3). renderCharacterOptions below falls back to this account's
  // first character if the stored id doesn't belong to it.
  let selectedCharacterId: string | null = localStorage.getItem(CHARACTER_STORAGE_KEY);

  function renderAccountOptions(): void {
    select.innerHTML = accounts
      .map((a) => `<option value="${a.id}"${a.id === selectedAccountId ? " selected" : ""}>${a.displayName}${a.role === "root" ? " (root)" : ""}</option>`)
      .join("");
  }

  function renderCharacterOptions(): void {
    if (!characters.some((c) => c.id === selectedCharacterId)) {
      selectedCharacterId = characters[0]?.id ?? null;
    }
    if (selectedCharacterId) localStorage.setItem(CHARACTER_STORAGE_KEY, selectedCharacterId);
    characterSelect.innerHTML =
      `<option value="">(no character)</option>` +
      characters.map((c) => `<option value="${c.id}"${c.id === selectedCharacterId ? " selected" : ""}>${c.name}</option>`).join("");
  }

  async function loadCharactersForSelectedAccount(): Promise<void> {
    if (!selectedAccountId) {
      characters = [];
      renderCharacterOptions();
      return;
    }
    characters = await fetchCharactersForAccount(httpUrl, selectedAccountId);
    renderCharacterOptions();
  }

  characterSelect.addEventListener("change", () => {
    selectedCharacterId = characterSelect.value || null;
    if (selectedCharacterId) localStorage.setItem(CHARACTER_STORAGE_KEY, selectedCharacterId);
    else localStorage.removeItem(CHARACTER_STORAGE_KEY);
  });

  createCharacterBtn.addEventListener("click", () => {
    const name = newCharacterNameInput.value.trim();
    if (!name || !selectedAccountId) return;
    void createCharacter(httpUrl, selectedAccountId, name, hexToColor(newCharacterColorInput.value)).then((character) => {
      characters.push(character);
      selectedCharacterId = character.id;
      localStorage.setItem(CHARACTER_STORAGE_KEY, character.id);
      newCharacterNameInput.value = "";
      newCharacterColorInput.value = colorToHex(randomCharacterColor());
      renderCharacterOptions();
    });
  });

  function renderGamesList(): void {
    const filtered = fuzzyMatch(searchInput.value, games, (g) => g.name).map((r) => r.item);
    if (filtered.length === 0) {
      listEl.innerHTML = `<li class="empty">No games found.</li>`;
      return;
    }
    listEl.innerHTML = filtered
      .map((g) => {
        const account = accounts.find((a) => a.id === selectedAccountId);
        const relation = account && g.ownerAccountId === account.id ? "owner" : account?.role === "root" ? "root" : "admin";
        return `<li><span>${g.name}<span class="game-meta">(${relation})</span></span><button class="play-btn" type="button" data-game-id="${g.id}">Play</button></li>`;
      })
      .join("");
  }

  async function loadGamesForSelectedAccount(): Promise<void> {
    if (!selectedAccountId) {
      games = [];
      renderGamesList();
      return;
    }
    games = await fetchGames(httpUrl, selectedAccountId);
    renderGamesList();
  }

  select.addEventListener("change", () => {
    selectedAccountId = select.value;
    localStorage.setItem(ACCOUNT_STORAGE_KEY, selectedAccountId);
    void loadGamesForSelectedAccount();
    void loadCharactersForSelectedAccount();
  });

  createAccountBtn.addEventListener("click", () => {
    const displayName = newAccountNameInput.value.trim();
    if (!displayName) return;
    void createAccount(httpUrl, displayName).then((account) => {
      accounts.push(account);
      selectedAccountId = account.id;
      localStorage.setItem(ACCOUNT_STORAGE_KEY, account.id);
      newAccountNameInput.value = "";
      renderAccountOptions();
      void loadGamesForSelectedAccount();
      void loadCharactersForSelectedAccount();
    });
  });

  createGameBtn.addEventListener("click", () => {
    const name = newGameNameInput.value.trim();
    if (!name || !selectedAccountId) return;
    const ownerAccountId = selectedAccountId;
    void createGame(httpUrl, name, ownerAccountId)
      // Every game needs at least one world to actually enter -- the
      // in-game page-management panel (pageManager.ts) that would
      // otherwise create one can only be reached from inside an active
      // session, so a brand-new game can't be left empty the way a world-
      // less game would be. Same "auto-create a starter DEFAULT_GENERATOR_ID
      // world" pattern store.ts's ensureSeedData() already uses for the
      // seeded games.
      .then((game) => createWorldInGame(httpUrl, game.id, ownerAccountId, "Starting World", DEFAULT_GENERATOR_ID, {}).then(() => game))
      .then((game) => {
        games.push(game);
        newGameNameInput.value = "";
        renderGamesList();
      });
  });

  searchInput.addEventListener("input", renderGamesList);

  listEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".play-btn");
    const gameId = button?.dataset.gameId;
    const account = accounts.find((a) => a.id === selectedAccountId);
    const game = games.find((g) => g.id === gameId);
    if (!game || !account) return;
    void fetchWorldsForGame(httpUrl, game.id).then((worlds) => {
      const world = worlds[0];
      if (!world) {
        console.error(`[lobby] game "${game.name}" has no worlds to enter`);
        return;
      }
      onPlay(game, world, account, selectedCharacterId);
    });
  });

  void (async () => {
    accounts = await fetchAccounts(httpUrl);
    if (!selectedAccountId || !accounts.some((a) => a.id === selectedAccountId)) {
      selectedAccountId = accounts[0]?.id ?? null;
    }
    renderAccountOptions();
    await loadGamesForSelectedAccount();
    await loadCharactersForSelectedAccount();
  })();
}
