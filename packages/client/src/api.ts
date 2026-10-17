// Thin REST client for the server's accounts/games/worlds endpoints --
// shared by lobby.ts (the normal flow), main.ts (reconstructing state on a
// direct /game/:id load or page refresh), and pageManager.ts (the in-game
// page-management panel's create/list-worlds calls).
//
// Games-and-world-generators PR: the lobby now operates on Games (the
// roll20-"campaign" concept) instead of Worlds directly -- Worlds (roll20
// "pages") are listed/created per-game from inside an active game session
// (pageManager.ts), not from this outer lobby. See docs/ROADMAP.md's
// Standing Decisions for the full Game/World split.

import type { GeneratorId, GeneratorParams } from "@ttrpg3d/shared";

export interface Account {
  id: string;
  displayName: string;
  role: "root" | "normal";
  createdAt: number;
}

export interface GameRecord {
  id: string;
  name: string;
  ownerAccountId: string;
  adminAccountIds: string[];
  createdAt: number;
  /** MVP goal item 3 (docs/ROADMAP.md) -- which mods this game has enabled, by id. Per-GAME, not per-world (real correction, 2026-10-17). */
  modIds: string[];
}

export interface WorldRecord {
  id: string;
  gameId: string;
  name: string;
  generatorId: GeneratorId;
  params: GeneratorParams;
  createdAt: number;
}

/** MVP goal item 3 (docs/ROADMAP.md) -- mirrors the server's modLoader.ts ModManifest exactly. */
export interface ModManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
}

export interface ChatMessage {
  id: number;
  senderName: string;
  text: string;
  createdAt: number;
}

export interface StatusEffect {
  icon: string;
  label: string;
}

/** MVP goal items 1-2 (docs/ROADMAP.md) -- mirrors the server's store.ts CharacterRecord exactly. */
export interface CharacterRecord {
  id: string;
  ownerAccountId: string;
  name: string;
  token: { color: [number, number, number] };
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  statusEffects: StatusEffect[];
  createdAt: number;
}

export const ACCOUNT_STORAGE_KEY = "ttrpg3d.accountId";
export const CHARACTER_STORAGE_KEY = "ttrpg3d.characterId";

export async function fetchAccounts(httpUrl: string): Promise<Account[]> {
  const res = await fetch(`${httpUrl}/accounts`);
  return res.json();
}

export async function createAccount(httpUrl: string, displayName: string): Promise<Account> {
  const res = await fetch(`${httpUrl}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  return res.json();
}

export async function fetchGames(httpUrl: string, accountId: string): Promise<GameRecord[]> {
  const res = await fetch(`${httpUrl}/games?account=${encodeURIComponent(accountId)}`);
  return res.json();
}

export async function createGame(httpUrl: string, name: string, ownerAccountId: string): Promise<GameRecord> {
  const res = await fetch(`${httpUrl}/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ownerAccountId }),
  });
  return res.json();
}

export async function fetchWorldsForGame(httpUrl: string, gameId: string): Promise<WorldRecord[]> {
  const res = await fetch(`${httpUrl}/games/${encodeURIComponent(gameId)}/worlds`);
  return res.json();
}

/** Admin-gated server-side (store.isGameAdmin) -- accountId is the caller's own, not trusted blindly, just checked fresh. */
export async function createWorldInGame(httpUrl: string, gameId: string, accountId: string, name: string, generatorId: GeneratorId, params: GeneratorParams): Promise<WorldRecord> {
  const res = await fetch(`${httpUrl}/games/${encodeURIComponent(gameId)}/worlds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, name, generatorId, params }),
  });
  return res.json();
}

export async function fetchCharactersForAccount(httpUrl: string, accountId: string): Promise<CharacterRecord[]> {
  const res = await fetch(`${httpUrl}/accounts/${encodeURIComponent(accountId)}/characters`);
  return res.json();
}

export async function createCharacter(httpUrl: string, accountId: string, name: string, color: [number, number, number]): Promise<CharacterRecord> {
  const res = await fetch(`${httpUrl}/accounts/${encodeURIComponent(accountId)}/characters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  return res.json();
}

/** Reads only -- sends go through the live GameRoom connection (chatNet.ts), never REST. `beforeId` fetches an older scrollback page instead of the most recent messages. */
export async function fetchGameChat(httpUrl: string, gameId: string, options?: { limit?: number; beforeId?: number }): Promise<ChatMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.beforeId !== undefined) params.set("before", String(options.beforeId));
  const query = params.toString();
  const res = await fetch(`${httpUrl}/games/${encodeURIComponent(gameId)}/chat${query ? `?${query}` : ""}`);
  return res.json();
}

/** Every mod file available on the server, regardless of which games have it enabled -- MVP goal item 3 (docs/ROADMAP.md). */
export async function fetchAvailableMods(httpUrl: string): Promise<ModManifest[]> {
  const res = await fetch(`${httpUrl}/mods`);
  return res.json();
}

/** Per-GAME, not per-world (real correction, 2026-10-17). */
export async function fetchGameMods(httpUrl: string, gameId: string): Promise<string[]> {
  const res = await fetch(`${httpUrl}/games/${encodeURIComponent(gameId)}/mods`);
  return res.json();
}

/** Admin-gated server-side (store.isGameAdmin), same spirit as createWorldInGame -- accountId is the caller's own, not trusted blindly, just checked fresh. Returns the game's updated mod id list. */
export async function enableGameMod(httpUrl: string, gameId: string, accountId: string, modId: string): Promise<string[]> {
  const res = await fetch(`${httpUrl}/games/${encodeURIComponent(gameId)}/mods`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, modId }),
  });
  return res.json();
}

export async function disableGameMod(httpUrl: string, gameId: string, accountId: string, modId: string): Promise<string[]> {
  const res = await fetch(`${httpUrl}/games/${encodeURIComponent(gameId)}/mods/${encodeURIComponent(modId)}?accountId=${encodeURIComponent(accountId)}`, {
    method: "DELETE",
  });
  return res.json();
}
