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

import type { GeneratorId, GeneratorParams, CharacterSheetTemplate, LibraryCallSegment } from "@ttrpg3d/shared";

export interface Account {
  id: string;
  displayName: string;
  role: "root" | "normal";
  createdAt: number;
  /** MVP goal item 4 (docs/ROADMAP.md), slice 1 -- which mods this ACCOUNT has imported, by id. Per-ACCOUNT, not site-wide and not per-game -- resolves character-sheet templates on the standalone characters page. */
  importedModIds: string[];
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
  /** MVP goal item 4 (docs/ROADMAP.md), slice 1 -- other mod ids this mod needs to function. */
  dependencies?: string[];
  /** MVP goal item 4, round 2 -- "relevant to character sheets at all" (a template, a library, or both). The characters page's mods list filters on this. */
  characterSheet?: boolean;
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
  statusEffects: StatusEffect[];
  createdAt: number;
  /** MVP goal item 4 (docs/ROADMAP.md) -- which mod this sheet was last cloned from / depends on as a library; null until picked. */
  templateId: string | null;
  /** The character's OWN editable pages/variables (round 2) -- null until started (blank or cloned from a mod template). */
  customSheet: CharacterSheetTemplate | null;
  /** Flat map keyed by variable id (customSheet's own variables + the core RESERVED_BODY_SIZE_VARIABLES ids). */
  variableValues: Record<string, number | string>;
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

// ---- MVP goal item 4 (docs/ROADMAP.md), slice 1: account-imported mods
// and character-sheet data. See store.ts's own doc on Account.importedModIds
// for why this is per-ACCOUNT, not per-game and not a bare scan of /mods.

export async function fetchAccountMods(httpUrl: string, accountId: string): Promise<string[]> {
  const res = await fetch(`${httpUrl}/accounts/${encodeURIComponent(accountId)}/mods`);
  return res.json();
}

/** Returns the account's updated imported-mod id list, same response shape as enableGameMod. */
export async function importAccountMod(httpUrl: string, accountId: string, modId: string): Promise<string[]> {
  const res = await fetch(`${httpUrl}/accounts/${encodeURIComponent(accountId)}/mods`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modId }),
  });
  return res.json();
}

export async function removeAccountMod(httpUrl: string, accountId: string, modId: string): Promise<string[]> {
  const res = await fetch(`${httpUrl}/accounts/${encodeURIComponent(accountId)}/mods/${encodeURIComponent(modId)}`, {
    method: "DELETE",
  });
  return res.json();
}

export interface CharacterSheetTemplateCatalogEntry {
  modId: string;
  manifest: ModManifest;
  template: CharacterSheetTemplate;
}

/** Scoped to the account's OWN importedModIds -- not every mod on disk, not any game's modIds. */
export async function fetchCharacterSheetTemplates(httpUrl: string, accountId: string): Promise<CharacterSheetTemplateCatalogEntry[]> {
  const res = await fetch(`${httpUrl}/accounts/${encodeURIComponent(accountId)}/character-sheet-templates`);
  return res.json();
}

export interface CharacterSheetLibraryCatalogEntry {
  modId: string;
  manifest: ModManifest;
  /** Just the function NAMES -- the actual functions are server-side Node code and can't cross JSON. */
  functionNames: string[];
}

/** MVP goal item 4, round 5 -- "gotta make it so we actually know what the mod library names are." Same scope as fetchCharacterSheetTemplates. */
export async function fetchCharacterSheetLibraries(httpUrl: string, accountId: string): Promise<CharacterSheetLibraryCatalogEntry[]> {
  const res = await fetch(`${httpUrl}/accounts/${encodeURIComponent(accountId)}/character-sheet-libraries`);
  return res.json();
}

/** Ownership-gated server-side (must be the character's own ownerAccountId) -- accountId is the caller's own, not trusted blindly, just checked fresh. Replaces templateId/customSheet/variableValues wholesale. Returns the updated CharacterRecord. */
export async function updateCharacterSheet(httpUrl: string, characterId: string, accountId: string, templateId: string | null, customSheet: CharacterSheetTemplate | null, variableValues: Record<string, number | string>): Promise<CharacterRecord> {
  const res = await fetch(`${httpUrl}/characters/${encodeURIComponent(characterId)}/sheet`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, templateId, customSheet, variableValues }),
  });
  return res.json();
}

/**
 * docs/CHARACTER_SHEET_IMPORT.md, part 2 -- "a new upload endpoint,
 * writing to disk." `file` is read+base64-encoded here (no multipart/
 * FormData handling exists anywhere in this project's HTTP layer --
 * this keeps the SAME plain-JSON-body convention every other endpoint
 * already uses). Returns a URL PATH (e.g. "/uploads/<id>.png"), not a
 * full origin -- same convention `httpUrl` itself already follows;
 * callers resolve it against `httpUrl`'s own origin when they need an
 * absolute URL (e.g. to feed a Babylon texture loader).
 */
export async function uploadImage(httpUrl: string, accountId: string, file: File): Promise<{ url: string }> {
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const res = await fetch(`${httpUrl}/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, mimeType: file.type, dataBase64 }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "upload failed");
  return res.json();
}

/**
 * MVP goal item 4, round 2 -- resolves a page's `{{modId.fn(args)}}`
 * library calls (findLibraryCalls) against the account's own
 * importedModIds, since a mod's real function body is server-side
 * Node code with no way to run it in the browser. Markdown PARSING
 * itself still happens client-side (marked + DOMPurify) -- only the
 * library-call resolution half needs this round trip.
 */
/** MVP goal item 4, round 3 -- `segments` carries each `{{modId.fn(args)}}` call's OWN resolved value (not just the flattened `resolvedMarkdown`), so the caller can render each one as a clickable "roll chip" instead of plain substituted text. */
export interface CharacterSheetPreviewResult {
  resolvedMarkdown: string;
  segments: (LibraryCallSegment & { value: string })[];
}

export async function fetchCharacterSheetPreview(httpUrl: string, accountId: string, markdown: string, variableValues: Record<string, number | string>): Promise<CharacterSheetPreviewResult> {
  const res = await fetch(`${httpUrl}/accounts/${encodeURIComponent(accountId)}/character-sheet-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, variableValues }),
  });
  return res.json();
}

// ---- MVP goal item 4 follow-up (docs/ROADMAP.md) -- the in-game
// "Characters" tab: a many-to-many game<->character link, with
// optional folders, mirroring the server's store.ts GameCharacterLink
// exactly.

export interface GameCharacterLink {
  id: string;
  gameId: string;
  characterId: string;
  folder: string | null;
  /** "all" = every player in the game; otherwise the exact list of account ids permitted to see/open it. */
  visibility: "all" | string[];
}

export interface VisibleGameCharacterEntry {
  link: GameCharacterLink;
  character: Pick<CharacterRecord, "id" | "name" | "token" | "ownerAccountId">;
}

export interface GameCharactersResult {
  links: VisibleGameCharacterEntry[];
  /** Distinct owners of EVERY character linked to this game, regardless of visibility -- the candidate roster a visibility-editing UI picks specific players FROM. */
  participantAccounts: { id: string; displayName: string }[];
}

export async function fetchGameCharacters(httpUrl: string, gameId: string, accountId: string): Promise<GameCharactersResult> {
  const res = await fetch(`${httpUrl}/games/${encodeURIComponent(gameId)}/characters?accountId=${encodeURIComponent(accountId)}`);
  return res.json();
}

/** Self-service: links the CALLER's own character, or (if `accountId` is a game admin) any character -- gated server-side (store.linkCharacterToGame). Returns the account's own updated visible list. */
export async function linkCharacterToGame(httpUrl: string, gameId: string, accountId: string, characterId: string, folder?: string | null): Promise<GameCharactersResult> {
  const res = await fetch(`${httpUrl}/games/${encodeURIComponent(gameId)}/characters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, characterId, folder }),
  });
  return res.json();
}

export async function updateGameCharacterLink(httpUrl: string, gameId: string, accountId: string, characterId: string, patch: { folder?: string | null; visibility?: "all" | string[] }): Promise<GameCharactersResult> {
  const res = await fetch(`${httpUrl}/games/${encodeURIComponent(gameId)}/characters/${encodeURIComponent(characterId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, ...patch }),
  });
  return res.json();
}

export async function unlinkCharacterFromGame(httpUrl: string, gameId: string, accountId: string, characterId: string): Promise<GameCharactersResult> {
  const res = await fetch(`${httpUrl}/games/${encodeURIComponent(gameId)}/characters/${encodeURIComponent(characterId)}?accountId=${encodeURIComponent(accountId)}`, {
    method: "DELETE",
  });
  return res.json();
}

/** Fetches a single character by id for a viewer who doesn't necessarily own it (fetchCharactersForAccount is scoped to one account's OWN characters only) -- backs the in-game character-sheet popup/popout. `canEdit` is computed server-side so the client never re-implements the admin/ownership check. */
export async function fetchCharacter(httpUrl: string, characterId: string, viewerAccountId: string): Promise<{ character: CharacterRecord; canEdit: boolean }> {
  const res = await fetch(`${httpUrl}/characters/${encodeURIComponent(characterId)}?viewerAccountId=${encodeURIComponent(viewerAccountId)}`);
  return res.json();
}

/** MVP goal item 4 follow-up ("deleting a character") -- owner-only server-side, deliberately stricter than canAccountEditCharacter (see server.ts's own doc). */
export async function deleteCharacter(httpUrl: string, characterId: string, accountId: string): Promise<void> {
  await fetch(`${httpUrl}/characters/${encodeURIComponent(characterId)}?accountId=${encodeURIComponent(accountId)}`, {
    method: "DELETE",
  });
}
