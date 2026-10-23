# Deferred

Renamed from "Backlog" (2026-10-23, real correction): "a backlog would
be things we're going to do, and we may or may not do deferred stuff."
Nothing here is committed future work -- it's real, scoped follow-up
that was deliberately NOT included in the current MVP push, might get
built later, and might not. Pull an item back into `docs/ROADMAP.md`'s
active phase list (or that item's own detail doc) when it's actually
decided and time to build it, rather than building it opportunistically
alongside unrelated work.

## From item 6 (turn-based battle system)

Full requirements for item 6 itself live in `docs/BATTLE_SYSTEM.md` --
these pieces are explicitly NOT part of that first pass:

- **A general-purpose, multi-step Ctrl+Z undo history.** Real
  correction (2026-10-23): the first draft of `docs/BATTLE_SYSTEM.md`
  scoped Ctrl+Z as a single-step "revert to this turn's start" action
  -- wrong framing. If Ctrl+Z is ever built, it should be a REAL
  general-purpose undo history, not a special-cased single revert.
  Not a priority right now -- the actual turn-start-revert feature
  ships as plain buttons/context-menu items instead (no keybind for
  now; "we'll decide a keybind later").
- **Auto-triggering an encounter** -- some trigger condition
  automatically starts battle mode, with AI involvement and an
  end-condition. Real user call (2026-10-23): "while it's fun, it's
  not quite vtt." The original old-game TODO this would have ported
  from left trigger/AI/end-condition all unspecified anyway -- there's
  no existing design to even start from.
- **Line-of-sight lines.** Real user call (2026-10-23): "actually
  helpful even before that, but out of scope for the MVP stuff...
  might come up as a needed feature for some games later." Also
  blocked on Phase 10 (AI/vision cones) existing first, per
  `docs/PORTING_CHECKLIST.md`.

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
