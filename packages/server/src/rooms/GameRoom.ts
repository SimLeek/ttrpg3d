// Chat + presence room: one instance per Game (not per World/page --
// see server.ts's `.filterBy(["gameId"])` registration), so both
// survive this project's existing per-page stop()+startGame() client
// teardown/rebuild cycle instead of flickering/reconnecting on every
// page switch.
//
// Two deliberately different state mechanisms for two different kinds
// of data (panel UI chrome PR, 2026-10-16):
// - CHAT is a discrete event log (broadcast + persist), not
//   continuously-synced live state -- NOT Schema. ALL history (initial
//   load + scrollback) goes through the REST endpoint (server.ts's
//   getGameChat) instead of a join-time message; this room only ever
//   broadcasts NEW messages, via onMessage handlers registered
//   synchronously in onCreate (no `await` between room creation and
//   handler registration -- the same safe timing WorldRoom's own
//   handlers already rely on). Real bug class THIS CODEBASE HAS ALREADY
//   HIT, deliberately avoided: WorldState.ts's own header comment
//   documents moving data out of an onJoin-sent message into Schema
//   specifically because such a message can arrive before the client's
//   own onMessage listener is registered.
// - PRESENCE (who's currently in this game, driving the party-list
//   panel) is the OPPOSITE shape -- genuinely continuously-synced live
//   state, exactly what Schema is for (GameState.ts, direct structural
//   mirror of WorldState.ts's own PlayerState/WorldState pair). Giving
//   presence a join-time message instead would reintroduce the exact
//   race described above; Schema's initial snapshot has no such race.
//
// Dice rolls are evaluated HERE, server-side only, never trusting a
// client-reported result -- matches this project's established
// trust-boundary split (voxel edits/admin checks are server-checked even
// though movement itself is client-trusted; see docs/ROADMAP.md's MVP
// goal section for why dice joins that same "must be fair" category).

import { Room, type Client } from "colyseus";
import { parseSlashRoll, findInlineRolls } from "@ttrpg3d/shared";
import { createChatStorage, type ChatStorage } from "../chat/chatStorage.js";
import { rollNotation } from "../chat/diceRoll.js";
import { GameState, PlayerPresence, type GameStateType } from "./GameState.js";
import { store } from "../data/store.js";
import { join } from "node:path";

interface JoinOptions {
  gameId?: string;
  name?: string;
  /** Sent by chatNet.ts alongside characterId -- used ONLY to resolve the default-character fallback (store.getDefaultCharacterForAccount) when no characterId is given, same as WorldRoom.ts's own accountId usage. Never trusted for anything auth-related here (this room has no admin concept). */
  accountId?: string;
  /** MVP goal items 1-2 (docs/ROADMAP.md) -- same resolve-server-side-via-store, tolerate-missing-gracefully shape as WorldRoom.ts's own characterId. Only the token color is needed here (party-list rendering); full HP/MP/status lives in WorldState.ts's PlayerState, scoped to an actual world session. */
  characterId?: string;
}

interface ChatSendMessage {
  text: string;
}

/** Substitutes every `[[...]]` segment in `text` with its resolved roll result (or an inline error marker for a malformed segment) -- graceful per-segment degradation, never drops the whole message over one bad segment. */
function resolveInlineRolls(text: string): string {
  const segments = findInlineRolls(text);
  if (segments.length === 0) return text;

  let result = "";
  let cursor = 0;
  for (const segment of segments) {
    result += text.slice(cursor, segment.start);
    const rolled = rollNotation(segment.notation);
    result += rolled.ok ? rolled.text : `[invalid dice: ${segment.notation}]`;
    cursor = segment.end;
  }
  result += text.slice(cursor);
  return result;
}

export class GameRoom extends Room<{ state: GameStateType }> {
  gameId = "default";
  storage!: ChatStorage;

  onCreate(options?: { gameId?: string }) {
    this.gameId = options?.gameId || "default";
    this.storage = createChatStorage(join(process.cwd(), "data", "chat"), this.gameId);
    this.setState(new GameState());

    this.onMessage<ChatSendMessage>("chatSend", (client, message) => {
      const text = message.text?.trim();
      if (!text) return;
      const senderName = this.state.players.get(client.sessionId)?.name ?? "Unknown";

      const rollArg = parseSlashRoll(text);
      if (rollArg !== null) {
        const result = rollNotation(rollArg);
        if (!result.ok) {
          // Sender-only, never persisted/broadcast -- keeps the shared
          // log free of typo'd notation attempts.
          client.send("chatError", { reason: result.reason });
          return;
        }
        this.persistAndBroadcast(senderName, result.text);
        return;
      }

      this.persistAndBroadcast(senderName, resolveInlineRolls(text));
    });
  }

  private persistAndBroadcast(senderName: string, text: string): void {
    const message = this.storage.append(senderName, text);
    this.broadcast("chatMessage", message);
  }

  onJoin(client: Client, options?: JoinOptions) {
    const name = options?.name || `Player-${client.sessionId.slice(0, 4)}`;
    const presence = new PlayerPresence();
    presence.name = name;
    // Same default-character fallback as WorldRoom.ts's onJoin -- a
    // characterless join resolves/auto-creates the account's default
    // character instead of leaving the party-list panel showing a flat
    // placeholder color forever.
    const character = (options?.characterId ? store.getCharacter(options.characterId) : undefined) ?? store.getDefaultCharacterForAccount(options?.accountId ?? "");
    if (character) {
      presence.hasCharacter = true;
      presence.tokenColorR = character.token.color[0];
      presence.tokenColorG = character.token.color[1];
      presence.tokenColorB = character.token.color[2];
    }
    this.state.players.set(client.sessionId, presence);
    console.log(`[GameRoom:${this.gameId}] ${name} (${client.sessionId}) joined`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    console.log(`[GameRoom:${this.gameId}] ${client.sessionId} left`);
  }

  onDispose() {
    this.storage.close();
  }
}
