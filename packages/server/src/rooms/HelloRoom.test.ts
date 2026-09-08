// Phase 1: the concrete proof that @colyseus/testing works as the
// successor to the old Godot dev-console command-queue pattern -- boots a
// real in-process server against the actual room code, connects a real
// simulated client, sends a real message, asserts on the real reply. No
// browser, no manual verification, runs in a normal test suite.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { HelloMessage } from "@ttrpg3d/shared";
import { server } from "../server.js";

describe("HelloRoom", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(server);
  });

  afterAll(async () => {
    await colyseus.shutdown();
  });

  it("echoes a hello message back to the sender", async () => {
    const room = await colyseus.createRoom("hello", {});
    const client = await colyseus.connectTo(room);

    const reply = await new Promise<HelloMessage>((resolve) => {
      client.onMessage("hello", (message: HelloMessage) => resolve(message));
      client.send("hello", { text: "ping", sentAt: Date.now() } satisfies HelloMessage);
    });

    expect(reply.text).toBe("server received: ping");
  });
});
