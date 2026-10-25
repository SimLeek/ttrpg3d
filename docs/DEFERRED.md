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

- ~~**A general-purpose, multi-step Ctrl+Z undo history.**~~ **UN-
  deferred, 2026-10-24**: pulled back into `docs/BATTLE_SYSTEM.md`'s
  own in-scope section 3 (now "Reset Turn / Ctrl+Z+Ctrl+Y") -- direct
  user call reversing the 2026-10-23 deferral: "Reset turn would be
  nice but let's just add that in with a whole ctrl+z ctrl+y system
  which would include placing and removing blocks as well, and
  potentially movement/controls or at least pose snapshots." See that
  doc for the current (still not fully specified) shape.
- **Terrain & multi-projective drawing.** Real user call (2026-10-24):
  "the drawing on ground later on" -- explicitly scoped as future
  work, described in enough detail to resume from, not part of the
  current "Measurement shapes" push (`docs/BATTLE_SYSTEM.md` section
  6). Two halves, both novel designs (not a port -- distinct from, but
  related to, the existing voxel-fill draw tools already scoped in
  `docs/PORTING_CHECKLIST.md`'s Phase 7, which should be reconciled
  with this once picked up):
  - **Ground drawing without z-fighting**: rather than drawing
    directly on a transparent plane overlaid on terrain (z-fighting
    risk), place actual voxel-sized planes NEXT TO the relevant
    terrain voxels (offset outward by a small amount), each carrying a
    drawable transparent texture -- added as needed, only where
    drawing actually happens. To keep "which voxels need a plane"
    simple, odd-shaped block types (tall grass, etc.) are treated as a
    plain cube occupancy check, not their real visual geometry.
  - **Multi-projective 3D line drawing**: as the player draws (mouse-
    picking terrain, or whatever the ray hits), each picked point
    becomes two points: the picked point itself, and a second point
    between the pick and the camera's own origin, where that segment
    intersects the camera's near clip plane. Connecting these in
    sequence as the player continues builds up a 2D polygon (in that
    camera's own projected view). The player then repeats the same
    process from a SECOND, different perspective, producing a second
    polygon. Finalizing (an "Apply" button, or Enter) computes the
    INTERSECTION of the two polygons and keeps only that intersection
    as the actual 3D line drawing, given some width. Effectively
    manual two-view photogrammetry/triangulation for freehand 3D line
    art. Real geometry/implementation research needed before this is
    buildable -- nothing below "the idea" exists yet.
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
