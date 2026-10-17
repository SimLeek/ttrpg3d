import { describe, it, expect, beforeEach } from "vitest";
import { mountPartyListPanel } from "./partyListPanel.js";
import type { PresenceEntry } from "./chatNet.js";

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

interface FakePresenceSource {
  onPresenceChange: (cb: (players: PresenceEntry[]) => void) => () => void;
  trigger: (players: PresenceEntry[]) => void;
  unsubscribed: boolean;
}

function makeOnPresenceChange(): FakePresenceSource {
  let listener: ((players: PresenceEntry[]) => void) | null = null;
  const source: FakePresenceSource = {
    onPresenceChange: (cb) => {
      listener = cb;
      return () => {
        source.unsubscribed = true;
        listener = null;
      };
    },
    trigger: (players) => listener?.(players),
    unsubscribed: false,
  };
  return source;
}

describe("mountPartyListPanel", () => {
  it("renders the initial player list with names", () => {
    mountPartyListPanel(container, {
      initialPlayers: [{ sessionId: "a", name: "Alice" }, { sessionId: "b", name: "Bob" }],
      onPresenceChange: () => () => {},
    });
    const text = container.querySelector("#party-panel")!.textContent;
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
  });

  it("shows an uppercase first-initial avatar per player", () => {
    mountPartyListPanel(container, {
      initialPlayers: [{ sessionId: "a", name: "alice" }],
      onPresenceChange: () => () => {},
    });
    expect(container.querySelector(".party-avatar")!.textContent).toBe("A");
  });

  it("re-renders when presence changes live", () => {
    const { onPresenceChange, trigger } = makeOnPresenceChange();
    mountPartyListPanel(container, { initialPlayers: [{ sessionId: "a", name: "Alice" }], onPresenceChange });

    trigger([{ sessionId: "a", name: "Alice" }, { sessionId: "b", name: "Bob" }]);
    const text = container.querySelector("#party-panel")!.textContent;
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
  });

  it("never interprets a player's display name as HTML (XSS safety)", () => {
    mountPartyListPanel(container, {
      initialPlayers: [{ sessionId: "a", name: "<img src=x onerror=alert(1)>" }],
      onPresenceChange: () => () => {},
    });
    expect(container.querySelector("#party-panel")!.querySelector("img")).toBeNull();
    expect(container.querySelector(".party-name")!.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("renders a real per-character token color when present, falling back to the default placeholder background when absent (MVP goal items 1-2)", () => {
    mountPartyListPanel(container, {
      initialPlayers: [
        { sessionId: "a", name: "Aria", tokenColor: [1, 0, 0] },
        { sessionId: "b", name: "Bare" },
      ],
      onPresenceChange: () => () => {},
    });
    const avatars = container.querySelectorAll<HTMLDivElement>(".party-avatar");
    expect(avatars[0].style.background).toBe("rgb(255, 0, 0)");
    expect(avatars[1].style.background).toBe("");
  });

  it("the toggle button collapses and expands the panel", () => {
    mountPartyListPanel(container, { initialPlayers: [], onPresenceChange: () => () => {} });
    const panelEl = container.querySelector<HTMLDivElement>("#party-panel")!;
    const toggle = container.querySelector<HTMLButtonElement>("#party-toggle")!;
    expect(panelEl.classList.contains("collapsed")).toBe(false);
    toggle.click();
    expect(panelEl.classList.contains("collapsed")).toBe(true);
    toggle.click();
    expect(panelEl.classList.contains("collapsed")).toBe(false);
  });

  it("destroy() unsubscribes from presence updates", () => {
    const source = makeOnPresenceChange();
    const panel = mountPartyListPanel(container, { initialPlayers: [], onPresenceChange: source.onPresenceChange });
    expect(source.unsubscribed).toBe(false);
    panel.destroy();
    expect(source.unsubscribed).toBe(true);
  });
});
