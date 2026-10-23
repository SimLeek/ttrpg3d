import { describe, it, expect, vi, afterEach } from "vitest";
import type { Room } from "@colyseus/sdk";
import { installFocusCycling } from "./focusCycling.js";
import type { PlayerController } from "./movement/PlayerController.js";

const MY_ACCOUNT = "me-account";

function fakeRoom(otherCharacters: { instanceId: string; placedByAccountId: string; x: number; y: number; z: number }[]) {
  const send = vi.fn();
  const room = { sessionId: "me", state: { otherCharacters }, send } as unknown as Room;
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

  it("Tab cycles to the FRONT of the sender's OWN placed instances, teleporting locally and sending focusCharacter with direction 'next'", () => {
    const { room, send } = fakeRoom([
      { instanceId: "b", placedByAccountId: MY_ACCOUNT, x: 1, y: 2, z: 3 },
      { instanceId: "c", placedByAccountId: MY_ACCOUNT, x: 4, y: 5, z: 6 },
    ]);
    const playerController = fakePlayerController();
    installFocusCycling(room, playerController, MY_ACCOUNT);

    pressTab();

    expect(playerController.teleportTo).toHaveBeenCalledWith([1, 2, 3]);
    expect(send).toHaveBeenCalledWith("focusCharacter", { instanceId: "b", direction: "next" });
  });

  it("Shift+Tab cycles to the BACK of the sender's OWN placed instances, sending direction 'previous' -- the true inverse of Tab (WorldRoom.ts's own ring math)", () => {
    const { room, send } = fakeRoom([
      { instanceId: "b", placedByAccountId: MY_ACCOUNT, x: 1, y: 2, z: 3 },
      { instanceId: "c", placedByAccountId: MY_ACCOUNT, x: 4, y: 5, z: 6 },
    ]);
    const playerController = fakePlayerController();
    installFocusCycling(room, playerController, MY_ACCOUNT);

    pressTab(true);

    expect(playerController.teleportTo).toHaveBeenCalledWith([4, 5, 6]);
    expect(send).toHaveBeenCalledWith("focusCharacter", { instanceId: "c", direction: "previous" });
  });

  it("MVP goal item 4 follow-up (world-level otherCharacters, real request: placed instances now persist/live independent of any one session): another account's placed instance in the same world is never part of MY ring", () => {
    const { room, send } = fakeRoom([
      { instanceId: "mine", placedByAccountId: MY_ACCOUNT, x: 1, y: 2, z: 3 },
      { instanceId: "not-mine", placedByAccountId: "someone-else", x: 99, y: 99, z: 99 },
    ]);
    const playerController = fakePlayerController();
    installFocusCycling(room, playerController, MY_ACCOUNT);

    pressTab();

    expect(playerController.teleportTo).toHaveBeenCalledWith([1, 2, 3]); // the OTHER account's instance was skipped entirely
    expect(send).toHaveBeenCalledWith("focusCharacter", { instanceId: "mine", direction: "next" });
  });

  it("is a no-op when the sender has no placed instances of their own to cycle to (a real state -- a solo character, not an error), even if OTHER accounts have placed some", () => {
    const { room, send } = fakeRoom([{ instanceId: "not-mine", placedByAccountId: "someone-else", x: 1, y: 2, z: 3 }]);
    const playerController = fakePlayerController();
    installFocusCycling(room, playerController, MY_ACCOUNT);

    pressTab();

    expect(playerController.teleportTo).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing while a text input has DOM focus -- Tab's standard meaning there (move to the next field) takes priority", () => {
    const { room, send } = fakeRoom([{ instanceId: "b", placedByAccountId: MY_ACCOUNT, x: 1, y: 2, z: 3 }]);
    const playerController = fakePlayerController();
    installFocusCycling(room, playerController, MY_ACCOUNT);

    activeInput = document.createElement("input");
    document.body.appendChild(activeInput);
    activeInput.focus();

    pressTab();

    expect(playerController.teleportTo).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores a held-key repeat event (same guard every other hotkey in this codebase uses)", () => {
    const { room, send } = fakeRoom([{ instanceId: "b", placedByAccountId: MY_ACCOUNT, x: 1, y: 2, z: 3 }]);
    const playerController = fakePlayerController();
    installFocusCycling(room, playerController, MY_ACCOUNT);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Tab", repeat: true }));

    expect(playerController.teleportTo).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
