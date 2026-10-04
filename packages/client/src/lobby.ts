// Worlds lobby page: account switcher + fuzzy-searchable worlds list.
// Plain DOM/TS, no UI framework -- see the "Worlds lobby page" section of
// the architecture plan for why (a filtered list and an account dropdown
// don't need one; navigo alone covers the "add a router now" preference).

import { fuzzyMatch } from "@ttrpg3d/shared";
import { fetchAccounts, fetchWorlds, createAccount, ACCOUNT_STORAGE_KEY, type Account, type WorldRecord } from "./api.js";

export type { Account, WorldRecord };

export function mountLobby(container: HTMLElement, httpUrl: string, onPlay: (world: WorldRecord, account: Account) => void): void {
  container.innerHTML = `
    <style>
      .lobby { max-width: 640px; margin: 48px auto; font-family: system-ui, sans-serif; color: #eee; }
      .lobby h1 { font-size: 1.5rem; }
      .lobby .row { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; }
      .lobby input, .lobby select, .lobby button { font-size: 1rem; padding: 6px 10px; }
      .lobby ul { list-style: none; padding: 0; margin: 0; }
      .lobby li { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; margin-bottom: 6px; background: #2a2a2a; border-radius: 6px; }
      .lobby li .world-meta { color: #999; font-size: 0.85rem; margin-left: 8px; }
      .lobby .play-btn { cursor: pointer; }
      .lobby .empty { color: #888; padding: 10px 0; }
    </style>
    <div class="lobby">
      <h1>ttrpg3d -- Worlds</h1>
      <div class="row">
        <label for="account-select">Account:</label>
        <select id="account-select"></select>
        <input id="new-account-name" placeholder="New account display name" />
        <button id="create-account-btn" type="button">Create account</button>
      </div>
      <div class="row">
        <input id="search" placeholder="Search worlds..." style="flex:1" />
      </div>
      <ul id="worlds-list"></ul>
    </div>
  `;

  const select = container.querySelector<HTMLSelectElement>("#account-select")!;
  const newNameInput = container.querySelector<HTMLInputElement>("#new-account-name")!;
  const createBtn = container.querySelector<HTMLButtonElement>("#create-account-btn")!;
  const searchInput = container.querySelector<HTMLInputElement>("#search")!;
  const listEl = container.querySelector<HTMLUListElement>("#worlds-list")!;

  let accounts: Account[] = [];
  let worlds: WorldRecord[] = [];
  let selectedAccountId: string | null = localStorage.getItem(ACCOUNT_STORAGE_KEY);

  function renderAccountOptions(): void {
    select.innerHTML = accounts
      .map((a) => `<option value="${a.id}"${a.id === selectedAccountId ? " selected" : ""}>${a.displayName}${a.role === "root" ? " (root)" : ""}</option>`)
      .join("");
  }

  function renderWorldsList(): void {
    const filtered = fuzzyMatch(searchInput.value, worlds, (w) => w.name).map((r) => r.item);
    if (filtered.length === 0) {
      listEl.innerHTML = `<li class="empty">No worlds found.</li>`;
      return;
    }
    listEl.innerHTML = filtered
      .map((w) => {
        const account = accounts.find((a) => a.id === selectedAccountId);
        const relation = account && w.ownerAccountId === account.id ? "owner" : account?.role === "root" ? "root" : "admin";
        return `<li><span>${w.name}<span class="world-meta">(${relation})</span></span><button class="play-btn" type="button" data-world-id="${w.id}">Play</button></li>`;
      })
      .join("");
  }

  async function loadWorldsForSelectedAccount(): Promise<void> {
    if (!selectedAccountId) {
      worlds = [];
      renderWorldsList();
      return;
    }
    worlds = await fetchWorlds(httpUrl, selectedAccountId);
    renderWorldsList();
  }

  select.addEventListener("change", () => {
    selectedAccountId = select.value;
    localStorage.setItem(ACCOUNT_STORAGE_KEY, selectedAccountId);
    void loadWorldsForSelectedAccount();
  });

  createBtn.addEventListener("click", () => {
    const displayName = newNameInput.value.trim();
    if (!displayName) return;
    void createAccount(httpUrl, displayName).then((account) => {
      accounts.push(account);
      selectedAccountId = account.id;
      localStorage.setItem(ACCOUNT_STORAGE_KEY, account.id);
      newNameInput.value = "";
      renderAccountOptions();
      void loadWorldsForSelectedAccount();
    });
  });

  searchInput.addEventListener("input", renderWorldsList);

  listEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".play-btn");
    const worldId = button?.dataset.worldId;
    const account = accounts.find((a) => a.id === selectedAccountId);
    const world = worlds.find((w) => w.id === worldId);
    if (world && account) onPlay(world, account);
  });

  void (async () => {
    accounts = await fetchAccounts(httpUrl);
    if (!selectedAccountId || !accounts.some((a) => a.id === selectedAccountId)) {
      selectedAccountId = accounts[0]?.id ?? null;
    }
    renderAccountOptions();
    await loadWorldsForSelectedAccount();
  })();
}
