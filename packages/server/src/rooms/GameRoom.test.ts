import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { server } from "../server.js";
import { GameRoom } from "./GameRoom.js";

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
