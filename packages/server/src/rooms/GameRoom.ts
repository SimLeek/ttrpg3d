// Chat room: one instance per Game (not per World/page -- see
// server.ts's `.filterBy(["gameId"])` registration), so chat survives
// this project's existing per-page stop()+startGame() client teardown/
// rebuild cycle instead of flickering/reconnecting on every page switch.
//
// Deliberately NO Colyseus Schema state (`extends Room`, no generic,
// never calls setState -- same shape HelloRoom.ts already uses) -- chat
// is a discrete event log (broadcast + persist), not continuously-synced
// live state like WorldRoom's player positions.
//
// Real bug class THIS CODEBASE HAS ALREADY HIT, deliberately avoided
// here: WorldState.ts's own header comment documents moving data out of
// an onJoin-sent message into Schema specifically because a message
// sent from onJoin can arrive before the client's own onMessage listener
// is registered. Rather than push chat history via such a message, ALL
// history (initial load + scrollback) goes through the REST endpoint
// (server.ts's getGameChat) instead -- this room only ever broadcasts
// NEW messages, via onMessage handlers registered synchronously in
// onCreate, the same safe timing WorldRoom's own handlers already rely
// on (no `await` between room creation and handler registration).
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
import { join } from "node:path";

interface JoinOptions {
  gameId?: string;
  name?: string;
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

export class GameRoom extends Room {
  gameId = "default";
  storage!: ChatStorage;
  private playerNames = new Map<string, string>();

  onCreate(options?: { gameId?: string }) {
    this.gameId = options?.gameId || "default";
    this.storage = createChatStorage(join(process.cwd(), "data", "chat"), this.gameId);

    this.onMessage<ChatSendMessage>("chatSend", (client, message) => {
      const text = message.text?.trim();
      if (!text) return;
      const senderName = this.playerNames.get(client.sessionId) ?? "Unknown";

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
    this.playerNames.set(client.sessionId, name);
    console.log(`[GameRoom:${this.gameId}] ${name} (${client.sessionId}) joined chat`);
  }

  onLeave(client: Client) {
    this.playerNames.delete(client.sessionId);
    console.log(`[GameRoom:${this.gameId}] ${client.sessionId} left chat`);
  }

  onDispose() {
    this.storage.close();
  }
}
