# Backlog / deferred

Real, scoped follow-ups that are explicitly NOT part of the current
MVP push -- not forgotten, just deliberately deferred so the MVP
system (`docs/ROADMAP.md`) ships first. Pull an item back into
ROADMAP.md's active phase list when it's actually time to build it,
rather than building it opportunistically alongside unrelated work.

## From item 4 (full character-sheet authoring system)

- **Mod-based sheet importers** (Excel sheets from paid westmarches
  servers, Roll20/Foundry JSON exports, etc.) -- the import mechanism
  itself was always meant to be a pluggable mod interface, not bespoke
  native parsers per format. **Explicitly held pending real test data**
  (2026-10-21): "hold on mod based importers for now until I get some
  test sheets to work with" -- don't design the importer mod interface
  against guessed shapes.
- **A safe/sandboxed scripting system** for calculated variables (e.g.
  a derived modifier) and RNG-driven attacks that auto-roll and post to
  chat. Partially covered today by `characterSheetLibrary` (trusted,
  mod-author-written functions callable from markdown via
  `{{modId.fn(args)}}`) -- but that's fixed, pre-written mod code, not
  a sandboxed scripting language a SHEET AUTHOR (not a mod author)
  could write their own formulas in. Real sandboxing (can't touch the
  filesystem/network/other characters' data, can't infinite-loop the
  server) is real design work, not a quick add.
- **Mods need a way to split game-affecting behavior from sheet-only
  behavior, so ONE mod implementation works unmodified in both the
  standalone characters page and an active game.** A character-sheet-
  template mod's functions that only touch the sheet/variables/chat-
  preview must be callable from the sheet-only context; any functions
  that touch live game state (the world, other players, voxels) must
  be excluded/filtered out there entirely, not just inert. A real
  constraint on item 3's `ModContext` (today deliberately an empty
  type, per that item's own "don't pre-build the content-specific API
  before its real shape is known" direction) -- confirmed still
  unexercised (2026-10-21): no mod built yet actually touches live
  game state from a library function, so this constraint has never
  been tested against a real case.
