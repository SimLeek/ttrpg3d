import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Room } from "@colyseus/sdk";
import { installFocusCycling } from "./focusCycling.js";
import type { PlayerController } from "./movement/PlayerController.js";

function fakeRoom(otherCharacters: { characterId: string; x: number; y: number; z: number }[]) {
  const send = vi.fn();
  const players = new Map([["me", { otherCharacters }]]);
  const room = { sessionId: "me", state: { players }, send } as unknown as Room;
  return { room, send };
}

function fakePlayerController() {
  return { teleportTo: vi.fn() } as unknown as PlayerController & { teleportTo: ReturnType<typeof vi.fn> };
}

function pressTab(shiftKey = false) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Tab", shiftKey }));
}

describe("installFocusCycling (Tab/Shift+Tab, MVP goal item 4 follow-up)", () => {
  let activeInput: HTMLInputElement | null = null;

  afterEach(() => {
    activeInput?.remove();
    activeInput = null;
  });

  it("Tab cycles to the FRONT of otherCharacters, teleporting locally and sending focusCharacter with direction 'next'", () => {
    const { room, send } = fakeRoom([
      { characterId: "b", x: 1, y: 2, z: 3 },
      { characterId: "c", x: 4, y: 5, z: 6 },
    ]);
    const playerController = fakePlayerController();
    installFocusCycling(room, playerController);

    pressTab();

    expect(playerController.teleportTo).toHaveBeenCalledWith([1, 2, 3]);
    expect(send).toHaveBeenCalledWith("focusCharacter", { characterId: "b", direction: "next" });
  });

  it("Shift+Tab cycles to the BACK of otherCharacters, sending direction 'previous' -- the true inverse of Tab (WorldRoom.ts's own ring math)", () => {
    const { room, send } = fakeRoom([
      { characterId: "b", x: 1, y: 2, z: 3 },
      { characterId: "c", x: 4, y: 5, z: 6 },
    ]);
    const playerController = fakePlayerController();
    installFocusCycling(room, playerController);

    pressTab(true);

    expect(playerController.teleportTo).toHaveBeenCalledWith([4, 5, 6]);
    expect(send).toHaveBeenCalledWith("focusCharacter", { characterId: "c", direction: "previous" });
  });

  it("is a no-op when the session has no otherCharacters to cycle to (a real state -- a solo character, not an error)", () => {
    const { room, send } = fakeRoom([]);
    const playerController = fakePlayerController();
    installFocusCycling(room, playerController);

    pressTab();

    expect(playerController.teleportTo).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing while a text input has DOM focus -- Tab's standard meaning there (move to the next field) takes priority", () => {
    const { room, send } = fakeRoom([{ characterId: "b", x: 1, y: 2, z: 3 }]);
    const playerController = fakePlayerController();
    installFocusCycling(room, playerController);

    activeInput = document.createElement("input");
    document.body.appendChild(activeInput);
    activeInput.focus();

    pressTab();

    expect(playerController.teleportTo).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores a held-key repeat event (same guard every other hotkey in this codebase uses)", () => {
    const { room, send } = fakeRoom([{ characterId: "b", x: 1, y: 2, z: 3 }]);
    const playerController = fakePlayerController();
    installFocusCycling(room, playerController);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Tab", repeat: true }));

    expect(playerController.teleportTo).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
