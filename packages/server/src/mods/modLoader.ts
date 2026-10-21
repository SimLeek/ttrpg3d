// Minimal mod load/unload mechanism -- MVP goal item 3 (docs/ROADMAP.md).
// Confirmed directly, not guessed: no mod-loading infrastructure exists
// anywhere in this codebase before this file (VOXEL_TYPES/worldGenerators
// are flat hardcoded arrays, not a plugin interface).
//
// Deliberately GENERIC, not pre-built for any specific content type (the
// explicit direction this item was planned under): a mod's entry module
// exports register(ctx)/unregister(ctx), where `ctx` is intentionally
// minimal here -- items 4/7/8 (character-sheet variables, default blocks,
// default generators) each extend what `ctx` offers when THEY'RE built,
// with real requirements only knowable at that point, not guessed now.
//
// Per-WORLD scoping, not per-game or global -- confirmed as the
// deliberate redesign in docs/PORTING_CHECKLIST.md's Phase 6 ("registration
// happens per-world at WorldRoom instantiation, not once globally at
// boot," a correction from the old Godot game's own global-at-boot
// ModManager autoload). Each WorldRoom gets its OWN createModLoader()
// instance (its own `loaded` tracking), since two worlds could have
// different mods enabled.
//
// No hot-reload, matching the old game's own real precedent
// (TODO_modding_and_worlds.md, Phase 0: "editing the file by hand is fine
// for now," toggle takes effect next launch) -- here, "next launch" is
// "next time this world's WorldRoom is created" (same precedent this
// project's own respawn-anchor persistence fix already established).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CharacterSheetTemplate } from "@ttrpg3d/shared";

export interface ModManifest {
  id: string;
  name: string;
  version: string;
  /** Relative to the mod's own directory, e.g. "entry.ts". */
  entry: string;
  /** MVP goal item 4 (docs/ROADMAP.md), slice 1 -- other mod ids this mod needs to function (e.g. a shared stats-library mod a character-sheet template depends on). One level only, not transitive, for this slice -- see characterSheet.ts's computeMissingModDependencies. */
  dependencies?: string[];
}

/**
 * Deliberately empty for item 3 -- see this file's own header. Still
 * empty for item 4's register()/unregister() lifecycle specifically:
 * a character-sheet-template mod doesn't need either of those at all
 * (see ModEntry's own doc below) -- it exports `characterSheetTemplate`
 * as plain data instead. Future items (7/8) extend THIS type once a
 * mod actually needs live registration hooks beyond what exists today.
 */
export type ModContext = Record<string, never>;

/**
 * MVP goal item 4 (docs/ROADMAP.md), slice 1: `register`/`unregister`
 * are now OPTIONAL -- a pure character-sheet-template mod exports only
 * `characterSheetTemplate`, no live-registration lifecycle at all,
 * which is what lets the same mod work unmodified both in a
 * WorldRoom (which only ever calls register/unregister, never reads
 * the template directly) and the standalone, game-free characters
 * page (which only ever reads `characterSheetTemplate`, never calls
 * register). A mod wanting both exports all three.
 */
export interface ModEntry {
  register?(ctx: ModContext): void;
  unregister?(ctx: ModContext): void;
  characterSheetTemplate?: CharacterSheetTemplate;
}

/** Scans `modsDir` for `<mod-id>/mod.json` manifests. Re-reads from disk every call, same "never cache, always read fresh" convention as store.ts's own loadX functions -- mod counts are small, caching isn't worth the staleness risk. Skips (does not throw on) a directory with no mod.json, or one whose manifest fails to parse -- a malformed mod shouldn't take down the whole list. */
export function listAvailableMods(modsDir: string): ModManifest[] {
  if (!existsSync(modsDir)) return [];
  const manifests: ModManifest[] = [];
  for (const entry of readdirSync(modsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(modsDir, entry.name, "mod.json");
    if (!existsSync(manifestPath)) continue;
    try {
      manifests.push(JSON.parse(readFileSync(manifestPath, "utf-8")) as ModManifest);
    } catch {
      // Malformed manifest -- skip it rather than crashing the whole list.
    }
  }
  return manifests;
}

/** Per-WorldRoom instance (see this file's header for why) -- tracks which mods THIS instance has loaded, so unloading calls the right entry module's unregister exactly once. */
export function createModLoader(modsDir: string) {
  const loaded = new Map<string, ModEntry>();

  return {
    listAvailableMods(): ModManifest[] {
      return listAvailableMods(modsDir);
    },

    isLoaded(modId: string): boolean {
      return loaded.has(modId);
    },

    /** No-op if already loaded or the mod id is unknown -- same "stale id, not a crash" spirit as store.ts's own writes. */
    async loadMod(modId: string, ctx: ModContext = {}): Promise<void> {
      if (loaded.has(modId)) return;
      const manifest = listAvailableMods(modsDir).find((m) => m.id === modId);
      if (!manifest) return;
      const entryPath = join(modsDir, modId, manifest.entry);
      const mod = (await import(pathToFileURL(entryPath).href)) as ModEntry;
      mod.register?.(ctx);
      loaded.set(modId, mod);
    },

    /** No-op if not currently loaded. */
    async unloadMod(modId: string, ctx: ModContext = {}): Promise<void> {
      const mod = loaded.get(modId);
      if (!mod) return;
      mod.unregister?.(ctx);
      loaded.delete(modId);
    },
  };
}

export type ModLoader = ReturnType<typeof createModLoader>;

/**
 * MVP goal item 4 (docs/ROADMAP.md), slice 1 -- resolves the
 * character-sheet templates provided by the given mod ids (e.g. an
 * account's own `importedModIds`), skipping any mod that doesn't
 * export `characterSheetTemplate` (an ordinary behavior-only mod,
 * or an unknown id). Deliberately NOT going through `createModLoader`'s
 * load/unload lifecycle at all -- reading a template is a plain,
 * side-effect-free data read, not a live registration action, so
 * there's no "loaded" state to track here (same reasoning `ModEntry`'s
 * own doc gives for why register/unregister are optional).
 */
export async function listCharacterSheetTemplates(modsDir: string, modIds: readonly string[]): Promise<{ modId: string; manifest: ModManifest; template: CharacterSheetTemplate }[]> {
  const manifests = listAvailableMods(modsDir);
  const results: { modId: string; manifest: ModManifest; template: CharacterSheetTemplate }[] = [];
  for (const modId of modIds) {
    const manifest = manifests.find((m) => m.id === modId);
    if (!manifest) continue;
    const entryPath = join(modsDir, modId, manifest.entry);
    const mod = (await import(pathToFileURL(entryPath).href)) as ModEntry;
    if (mod.characterSheetTemplate) results.push({ modId, manifest, template: mod.characterSheetTemplate });
  }
  return results;
}
