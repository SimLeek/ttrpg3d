// Thin REST client for the server's accounts/worlds endpoints -- shared by
// lobby.ts (the normal flow) and main.ts (reconstructing state on a direct
// /world/:id load or page refresh, see main.ts's doc comment).

export interface Account {
  id: string;
  displayName: string;
  role: "root" | "normal";
  createdAt: number;
}

export interface WorldRecord {
  id: string;
  name: string;
  ownerAccountId: string;
  adminAccountIds: string[];
  createdAt: number;
}

export const ACCOUNT_STORAGE_KEY = "ttrpg3d.accountId";

export async function fetchAccounts(httpUrl: string): Promise<Account[]> {
  const res = await fetch(`${httpUrl}/accounts`);
  return res.json();
}

export async function fetchWorlds(httpUrl: string, accountId: string): Promise<WorldRecord[]> {
  const res = await fetch(`${httpUrl}/worlds?account=${encodeURIComponent(accountId)}`);
  return res.json();
}

export async function createAccount(httpUrl: string, displayName: string): Promise<Account> {
  const res = await fetch(`${httpUrl}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  return res.json();
}
