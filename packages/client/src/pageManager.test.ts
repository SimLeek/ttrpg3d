import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountPageManager, type PageManagerController } from "./pageManager.js";

// pageManager.ts calls api.ts's fetch wrappers directly (unlike most other
// panels in this project, which take injected callbacks specifically to
// stay jsdom-testable without a fetch mock) -- stubbing global fetch here
// is the minimal way to exercise it without introducing a new mocking
// layer this codebase doesn't otherwise have.
function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

let container: HTMLElement;
let panel: PageManagerController | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/worlds") && (!init || init.method === undefined)) return jsonResponse([]);
    if (u.endsWith("/mods") && u.includes("/worlds/") === false) return jsonResponse([{ id: "example-noop", name: "Example", version: "0.1.0", entry: "entry.ts" }]);
    if (u.includes("/worlds/world-1/mods") && (!init || !init.method)) return jsonResponse([]);
    if (u.includes("/worlds/world-1/mods") && init?.method === "POST") return jsonResponse(["example-noop"]);
    if (u.includes("/worlds/world-1/mods/example-noop") && init?.method === "DELETE") return jsonResponse([]);
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  panel?.destroy();
  panel = null;
  container.remove();
  vi.unstubAllGlobals();
});

function mount(isAdmin: boolean) {
  panel = mountPageManager(container, {
    httpUrl: "http://test",
    gameId: "game-1",
    accountId: "account-1",
    currentWorldId: "world-1",
    isAdmin: () => isAdmin,
    onSwitchWorld: () => {},
  });
  return panel;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("mountPageManager's mod list (MVP goal item 3, docs/ROADMAP.md)", () => {
  it("fetches and renders the available mods with their current enabled state when an admin opens the panel", async () => {
    mount(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM" }));
    await flush();

    const list = container.querySelector<HTMLUListElement>("#mod-list")!;
    expect(list.textContent).toContain("Example");
    const button = list.querySelector<HTMLButtonElement>(".mod-toggle-btn")!;
    expect(button.textContent).toBe("Enable");
    expect(button.dataset.enabled).toBe("false");
  });

  it("clicking Enable calls the enable endpoint and re-renders as Disable", async () => {
    mount(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM" }));
    await flush();

    container.querySelector<HTMLButtonElement>(".mod-toggle-btn")!.click();
    await flush();

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall).toBeDefined();
    expect(JSON.parse(postCall![1].body as string)).toEqual({ accountId: "account-1", modId: "example-noop" });

    const button = container.querySelector<HTMLButtonElement>(".mod-toggle-btn")!;
    expect(button.textContent).toBe("Disable");
  });

  it("a non-admin can't open the panel at all, so the mod list never gets fetched", async () => {
    mount(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM" }));
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector(".page-mgr-overlay")!.classList.contains("open")).toBe(false);
  });
});
