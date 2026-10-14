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
}

export interface WorldRecord {
  id: string;
  gameId: string;
  name: string;
  generatorId: GeneratorId;
  params: GeneratorParams;
  createdAt: number;
}

export const ACCOUNT_STORAGE_KEY = "ttrpg3d.accountId";

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
