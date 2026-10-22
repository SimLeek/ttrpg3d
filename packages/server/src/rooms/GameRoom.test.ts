import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { server } from "../server.js";
import { GameRoom } from "./GameRoom.js";
import type { GameStateType } from "./GameState.js";
import { store } from "../data/store.js";

// GameRoom takes a bare gameId directly (no store.ts lookup, unlike
// WorldRoom) -- the only real filesystem artifact a test run leaves
// behind is its chat .sqlite file, tracked and swept here the same way
// WorldRoom.test.ts already does for its own per-world .sqlite files.
const usedGameIds: string[] = [];
function freshGameId(): string {
  const id = `GameRoom-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  usedGameIds.push(id);
  return id;
}

describe("GameRoom", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(server);
  });

  afterAll(async () => {
    await colyseus.shutdown();
    for (const gameId of usedGameIds) {
      rmSync(join(process.cwd(), "data", "chat", `${gameId}.sqlite`), { force: true });
    }
  });

  it("a plain message (no /roll, no [[...]]) broadcasts unchanged to every connected client", async () => {
    const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
    const sender = await colyseus.connectTo(room, { name: "Alice" });
    const observer = await colyseus.connectTo(room, { name: "Bob" });

    const received = new Promise<{ text: string; senderName: string }>((resolve) => {
      observer.onMessage("chatMessage", resolve);
    });
    sender.send("chatSend", { text: "hello everyone" });

    const message = await received;
    expect(message.text).toBe("hello everyone");
    expect(message.senderName).toBe("Alice");
  });

  it("/roll <valid notation> broadcasts a resolved human-readable result to every client, not the raw notation", async () => {
    const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
    const sender = await colyseus.connectTo(room, { name: "Alice" });
    const observer = await colyseus.connectTo(room, { name: "Bob" });

    const received = new Promise<{ text: string }>((resolve) => {
      observer.onMessage("chatMessage", resolve);
    });
    sender.send("chatSend", { text: "/roll 1d1" }); // deterministic: always 1

    const message = await received;
    expect(message.text).toContain("1d1");
    expect(message.text).not.toBe("/roll 1d1");
  });

  it("/roll <invalid notation> reaches only the sender (chatError), never broadcast or persisted", async () => {
    const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
    const sender = await colyseus.connectTo(room, { name: "Alice" });
    const observer = await colyseus.connectTo(room, { name: "Bob" });

    let observerSawChatMessage = false;
    observer.onMessage("chatMessage", () => {
      observerSawChatMessage = true;
    });
    const senderError = new Promise<{ reason: string }>((resolve) => {
      sender.onMessage("chatError", resolve);
    });
    sender.send("chatSend", { text: "/roll not dice at all" });

    const error = await senderError;
    expect(error.reason).toContain("not dice at all");
    await new Promise((resolve) => setTimeout(resolve, 50)); // give a (not expected) broadcast a chance to arrive
    expect(observerSawChatMessage).toBe(false);
  });

  it("an inline [[...]] segment inside an ordinary message is replaced with its resolved result, rest of the message untouched", async () => {
    const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
    const sender = await colyseus.connectTo(room, { name: "Alice" });
    const observer = await colyseus.connectTo(room, { name: "Bob" });

    const received = new Promise<{ text: string }>((resolve) => {
      observer.onMessage("chatMessage", resolve);
    });
    sender.send("chatSend", { text: "I attack for [[1d1+3]] damage" }); // deterministic: 1+3=4

    const message = await received;
    expect(message.text).toContain("I attack for");
    expect(message.text).toContain("damage");
    expect(message.text).not.toContain("[[1d1+3]]");
  });

  it("a malformed inline [[...]] segment degrades gracefully -- an inline error marker, rest of the message still delivered", async () => {
    const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
    const sender = await colyseus.connectTo(room, { name: "Alice" });
    const observer = await colyseus.connectTo(room, { name: "Bob" });

    const received = new Promise<{ text: string }>((resolve) => {
      observer.onMessage("chatMessage", resolve);
    });
    sender.send("chatSend", { text: "roll [[garbage]] please" });

    const message = await received;
    expect(message.text).toContain("roll");
    expect(message.text).toContain("please");
    expect(message.text).toContain("[invalid dice: garbage]");
  });

  it("a joining client's presence is visible to an already-connected client via Schema, with the real display name", async () => {
    const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
    const first = await colyseus.connectTo(room, { name: "Alice" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = await colyseus.connectTo(room, { name: "Bob" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bobAsSeenByFirst = Array.from((first.state as GameStateType).players.values()).find((p) => p.name === "Bob");
    expect(bobAsSeenByFirst).toBeDefined();
    expect((second.state as GameStateType).players.get(first.sessionId)?.name).toBe("Alice");
  });

  it("presence is removed when a client leaves", async () => {
    const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
    const leaver = await colyseus.connectTo(room, { name: "Leaver" });
    const observer = await colyseus.connectTo(room, { name: "Observer" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((observer.state as GameStateType).players.has(leaver.sessionId)).toBe(true);

    await leaver.leave();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((observer.state as GameStateType).players.has(leaver.sessionId)).toBe(false);
  });

  it("a joining client defaults to a Player-<id> name when none is given", async () => {
    const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
    const anon = await colyseus.connectTo(room);
    expect(room.state.players.get(anon.sessionId)?.name).toMatch(/^Player-/);
  });

  it("a join with a real characterId populates the presence's token color; a missing one leaves it at the 0,0,0 default (MVP goal items 1-2)", async () => {
    const owner = store.createAccount(`GameRoom-test-char-owner-${Date.now()}`);
    const character = store.createCharacter(owner.id, "Tokened", [0.1, 0.2, 0.3]);
    try {
      const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
      const withCharacter = await colyseus.connectTo(room, { characterId: character.id });
      const bare = await colyseus.connectTo(room);

      const presence = (room.state as GameStateType).players.get(withCharacter.sessionId)!;
      expect(presence.hasCharacter).toBe(true);
      expect([presence.tokenColorR, presence.tokenColorG, presence.tokenColorB]).toEqual([0.1, 0.2, 0.3]);

      const barePresence = (room.state as GameStateType).players.get(bare.sessionId)!;
      expect(barePresence.hasCharacter).toBe(false);
    } finally {
      store.deleteAccount(owner.id);
    }
  });

  it("a join with an accountId but no characterId falls back to that account's default character instead of staying characterless (MVP goal items 1-2)", async () => {
    const owner = store.createAccount(`GameRoom-test-fallback-owner-${Date.now()}`);
    store.createCharacter(owner.id, "Fallback", [0.4, 0.5, 0.6]);
    try {
      const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
      const client = await colyseus.connectTo(room, { accountId: owner.id });

      const presence = (room.state as GameStateType).players.get(client.sessionId)!;
      expect(presence.hasCharacter).toBe(true);
      expect([presence.tokenColorR, presence.tokenColorG, presence.tokenColorB]).toEqual([0.4, 0.5, 0.6]);
    } finally {
      store.deleteAccount(owner.id);
    }
  });

  it("chatSend's asCharacterId attributes the message to that character's name instead of the account's, when the sender's account is permitted to view it (MVP goal item 4 follow-up -- 'characters' tab)", async () => {
    const owner = store.createAccount(`GameRoom-test-ascharacter-owner-${Date.now()}`);
    const character = store.createCharacter(owner.id, "Thrain", [0.1, 0.2, 0.3]);
    try {
      const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
      const sender = await colyseus.connectTo(room, { name: "Alice", accountId: owner.id });
      const observer = await colyseus.connectTo(room, { name: "Bob" });

      const received = new Promise<{ text: string; senderName: string }>((resolve) => observer.onMessage("chatMessage", resolve));
      sender.send("chatSend", { text: "I attack!", asCharacterId: character.id });

      const message = await received;
      expect(message.senderName).toBe("Thrain");
      expect(message.text).toBe("I attack!");
    } finally {
      store.deleteAccount(owner.id);
    }
  });

  it("chatSend's asCharacterId falls back to the account's own name, not an error, when the sender isn't permitted to view that character (or the id is unknown/missing)", async () => {
    const owner = store.createAccount(`GameRoom-test-ascharacter-denied-owner-${Date.now()}`);
    const character = store.createCharacter(owner.id, "NotYours", [0.1, 0.2, 0.3]);
    try {
      const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
      const stranger = store.createAccount(`GameRoom-test-ascharacter-denied-stranger-${Date.now()}`);
      const sender = await colyseus.connectTo(room, { name: "Stranger", accountId: stranger.id });
      const observer = await colyseus.connectTo(room, { name: "Bob" });

      const received = new Promise<{ senderName: string }>((resolve) => observer.onMessage("chatMessage", resolve));
      sender.send("chatSend", { text: "sneaky", asCharacterId: character.id });

      const message = await received;
      expect(message.senderName).toBe("Stranger");
      store.deleteAccount(stranger.id);
    } finally {
      store.deleteAccount(owner.id);
    }
  });

  it("a blank message is silently ignored -- no broadcast, no error", async () => {
    const room = await colyseus.createRoom<GameRoom>("game", { gameId: freshGameId() });
    const sender = await colyseus.connectTo(room, { name: "Alice" });
    const observer = await colyseus.connectTo(room, { name: "Bob" });

    let sawAnything = false;
    observer.onMessage("chatMessage", () => (sawAnything = true));
    sender.onMessage("chatError", () => (sawAnything = true));
    sender.send("chatSend", { text: "   " });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sawAnything).toBe(false);
  });
});
