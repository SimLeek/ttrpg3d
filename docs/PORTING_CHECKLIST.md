# Porting checklist: old Godot repo → ttrpg3d

Working, file-by-file breakdown of every `.gd` file in the old repo
(`/home/simleek/gamedev/ttrpg-3d`, 83 files / 13,122 lines, `addons/` and
`examples_dd3d/` excluded as third-party), plus every still-open item from
that repo's four `TODO_*.md` docs, organized against the phases in
[`vectorized-jumping-sunset.md`](/home/simleek/.claude/plans/vectorized-jumping-sunset.md).
The old repo stays untouched and readable for the duration of the port (it's
also preserved on GitHub as `SimLeek/ttrpg3d-godot-old`) — **delete a file
from the old repo only after its port lands here and is verified**, not
before, so there's always a reference copy one `git log` away.

Decision tags used below:
- **PORT** — near-verbatim translation, logic carries over directly.
- **REDESIGN** — the concept/behavior carries over, the implementation doesn't
  (different engine APIs, different network model).
- **NEW** — real, unbuilt-even-in-the-old-repo feature work. These came from
  the TODO docs, not from existing files — don't go looking for GDScript to
  port, design them fresh using the old doc's open questions as a starting
  point.
- **DROP** — not worth carrying forward (dead code, engine-specific glue with
  no new-stack equivalent, or superseded).
- **DEFER** — real and worth doing, but not blocking, low priority, or needs
  a design spike before scheduling.

Standing principles to carry into every phase (already in memory from the old
project, reiterated across the TODO docs — don't regress on these):
- Tunable values (colors, sizes, thresholds, speeds) go in settings/config,
  not hardcoded constants.
- Never destroy a user's saved world/test data as a side effect of dev work.
- The old project's code-generated UI was tolerated, not loved — worth
  actually using a real UI approach in the new stack where it's not much
  extra cost, rather than reflexively rebuilding the same pattern.
- Where a system needs real engine/physics/shader capability (soft-body
  physics, shaders, etc.), prefer porting in a well-maintained JS/Babylon
  library over reimplementing Godot's custom workaround for it. Several of
  the old repo's biggest custom systems exist specifically to work around
  gaps in Godot/godot_voxel, not because the behavior itself is hard — the
  new stack's own ecosystem libraries are likely to just be better at these
  than a bespoke port would be.

---

## Early architectural priority — floating-origin shifting

`levels/center_of_universe.gd`'s floating-origin re-anchoring (shift the
world origin back toward zero as the player moves far from it, to avoid
float-precision jitter/glitches at large coordinates) is still a good idea
in the new stack, and **worth doing early** — as close to Phase 2 as
practical — rather than retrofitting it once movement, multiplayer position
sync, and world-streaming code all already assume a single fixed origin.
Retrofitting this kind of thing after the fact tends to touch everywhere
position is read or written; deciding the coordinate-system convention
(client-local re-anchoring vs. server-authoritative chunk-relative
coordinates — the server/multiplayer model makes this a bit different from
the old single-player version, worth a short design pass rather than a
direct port) up front avoids that. The old implementation's *hard* part
(manually re-baking `SoftBody3D` meshes on re-anchor) doesn't apply here if
the soft-body physics question below gets settled by using a real physics
library instead.

## Phase 2 — MVP (in progress / next up)

Scope is deliberately narrow per the plan (hardcoded flat world, walk+jump
only, one hardcoded block type). Relevant old files are references for the
*math/shape*, not things to port in full yet — the full versions land in
Phase 5/6.

- [ ] `scripts/movement_resource.gd` (94L) — **REDESIGN**, subset only (walk
      speed, no run/slow stats yet).
- [ ] `scripts/basic_jump_resource.gd` (53L) — **REDESIGN**, subset only (jump
      impulse, no coyote-time/wall-kick yet).
- [ ] `scripts/fall_resource.gd` (24L) — **REDESIGN**, gravity/terminal
      velocity only.
- [ ] `scripts/pcg/limestone_slab_generator.gd` (39L) — **PORT**, good
      candidate for literally being the Phase 2 hardcoded/trivial world
      generator (deterministic, no randomness, bounded).
- [ ] `scripts/items/voxelitem.gd` (91L) / `scripts/items/del_vox_item.gd`
      (55L) — **REDESIGN**, collapsed to "place/break one hardcoded block
      type," full multi-type version deferred to Phase 5.

## Phase 3 — Low-risk data/math ports

- [ ] `scripts/pcg/full_period_lcg.gd` (89L) — **PORT** near-verbatim.
- [ ] `scripts/pcg/spatial_hash_3d.gd` (112L) — **PORT** near-verbatim.
- [ ] `scripts/game_settings.gd` (198L) — **PORT** the Minkowski-norm
      distance math only; the Godot-autoload settings-persistence half moves
      to Phase 12 (client-side settings UI).
- [ ] `scripts/pcg/voxel_types.gd` (194L) — **PORT** the ~20 types actually
      wired to a display name/model today (per plan — not all ~59 reserved
      constants).
- [ ] `scripts/ui/dev_console_fade_state.gd` (29L) — **DEFER**. Pure,
      testable fade-alpha math, but the dev console's *function* is already
      superseded by `@colyseus/testing` (Phase 1, done); there's no in-browser
      debug-console UI planned yet for this math to serve. Revisit only if a
      live client-side debug console gets scheduled.

## Phase 4 — Real world management

- [ ] `scripts/world/world_manager.gd` (167L) — **REDESIGN** → per-world
      SQLite + `WorldRoom` mapping (already speced in the architecture plan).
- [ ] `scripts/pcg/world_generator_catalog.gd` (92L) — **PORT** the
      repeatable/non_repeatable/finite classification concept.
- [ ] `scripts/pcg/hilly_terrain_region_generator.gd` (464L) — **PORT**
      algorithm (noise-based height + biome features), largest single
      generator in the codebase.
- [ ] `scripts/pcg/generator_main.gd` (41L) — **DROP**. Pure
      `VoxelGeneratorScript` passthrough glue for Godot's generator plugin
      system; no equivalent indirection needed in TS.
- [ ] `scripts/pcg/structure.gd` (3L) — **PORT** trivial data holder.
- [ ] `scripts/pcg/tree_generator.gd` (73L) — **PORT** algorithm.
- [ ] `scripts/pcg/windmill_generator.gd` (109L) — **PORT** algorithm.
- [ ] `scripts/pcg/modified_block_tracker.gd` (73L) — **REDESIGN** → replaced
      by the SQLite `chunks` table's dirty-chunk tracking (direct
      architectural port per plan, different storage).
- [ ] `scripts/pcg/voxel_catalog.gd` (74L) — **REDESIGN**, catalog discovery
      moves from "scan a VoxelBlockyLibrary" to "read the shared TS voxel
      type table."
- [ ] `scripts/world/procedural_skybox.gd` (56L) — **PORT** the
      direction→color algorithm, rebuild the actual sky as a Babylon shader.
- [ ] **NEW** — Terraria-style depth-based skybox switch (underground vs.
      surface). Was never built in the old repo either.
- [ ] **DEFER/NEW** — Poisson-disc-in-capsule biome-boundary system and the
      "non-repeatable" (e.g. wave-function-collapse) generator category.
      Never implemented in the old repo (only a Python prototype existed) —
      not a regression to skip for now.
- [ ] **DEFER/NEW** — F1-menu world map with per-biome coloring. Blocked on
      the biome system above.
- [ ] Note: the limestone-slab generator's `voxel_id` fill-block picker param
      was implemented but **never live-tested** in the old repo — verify it
      properly against the new catalog rather than assuming it worked.
- [ ] **NEW** — import old worlds. The old repo's voxel data is stored via
      `VoxelStreamSQLite` — an actual per-world SQLite file — which should be
      directly convertible into the new per-world `chunks` table with a
      fairly small conversion script (schema differs, but it's SQLite→SQLite,
      not a format that needs re-simulating). Worth doing: these worlds were
      built for/with the same movement systems the new client is porting, so
      they're free, already-designed content, not just test data. Scope this
      once Phase 4's real per-world storage exists.

## Phase 5 — Full player movement + voxel interaction

- [ ] `scripts/player_blob_ctrl.gd` (377L) — **REDESIGN**, main controller
      hub, rebuilt against noa's AABB-sweep physics.
- [ ] `scripts/movement_resource.gd`, `basic_jump_resource.gd`,
      `fall_resource.gd` — **REDESIGN**, full versions now (stamina/run,
      coyote-time, etc.), superseding Phase 2's stubs.
- [ ] `scripts/wall_jump_resource.gd` (54L) — **REDESIGN**. Spike noa's
      contact-query API first (per plan — not confirmed it exposes
      Godot-`ShapeCast3D`-equivalent per-face contact queries).
- [ ] `scripts/ledge_safety_resource.gd` (210L) / `playable/ledge_grabber.gd`
      (359L) — **REDESIGN**, same contact-query spike applies.
- [ ] `scripts/stair_stepper_resource.gd` (25L) — **REDESIGN**.
- [ ] `playable/squeezer_rays.gd` (119L) — **REDESIGN**, low priority within
      this phase (tight-space movement slowdown, not core movement feel).
- [ ] `scripts/spring_arm_3d_look.gd` (103L) — **REDESIGN**, camera
      controller against Babylon's camera APIs.
- [ ] `scripts/input/input_controller.gd` (257L) — **REDESIGN**. Carries
      forward an important *pattern*, not just code: single reference-counted
      owner of "what currently owns player input," replacing scattered ad hoc
      mouse-mode checks. Worth pulling this pattern forward as soon as any UI
      competes with gameplay input, even if that's before Phase 5 lands fully.
- [ ] `scripts/item_resources/voxel_interactor.gd` (328L) — **REDESIGN**,
      shared placement-plane/targeting-beam logic against noa's picking API.
- [ ] `scripts/items/voxelitem.gd`, `del_vox_item.gd` — **REDESIGN**, full
      multi-block-type versions now.
- [ ] `scripts/items/phasing_gloves_item.gd` (20L), `wings_item.gd` (27L) —
      **PORT/REDESIGN**, small self-contained movement-mode items.
- [ ] `scripts/two_handed_resource.gd` (66L) — **REDESIGN**. Don't just
      port the old fixed click-dispatch mapping — TODO_battle_and_tools.md's
      unbuilt combat rework wants hand behavior to depend on what's
      *equipped* (empty = interact, pickaxe = attack, block = place),
      replacing the current always-right-click-deletes behavior. Fold that
      redesign in here rather than reproducing the old mapping and redoing
      it later. See also Phase 6/10 below.
- [ ] `playable/left_hand_gripper.gd` (201L) — **REDESIGN**, hand/item equip
      management.
- [ ] `playable/health.gd` (59L) — **PORT**, damage/regen model is mostly
      pure math + simple state.
- [ ] `playable/blob_body_3d.gd` (467L), `scripts/limited_blob_body.gd`
      (142L), `scripts/limited_blob_body_extra.gd` (199L) — **DROP as a
      porting target; replace with a real soft-body physics library.**
      ~808 lines of custom mass-spring soft-body code exist specifically
      because Godot's built-in `SoftBody3D` didn't survive this project's
      floating-origin re-anchoring (manual per-frame mesh re-baking was the
      workaround). That's a Godot-specific gap, not a hard problem in
      general — the new stack should be able to just use an existing,
      better-maintained JS soft-body/physics library instead of
      reimplementing one by hand. **NEW** — spike which library to use
      (options to evaluate live in whatever physics engine ends up paired
      with noa/Babylon) as its own small task before this phase's movement
      work depends on it.

## Phase 6 — Inventory/items

- [ ] `scripts/pcg/item_catalog.gd` (132L) — **PORT** data shape into shared
      TS schema.
- [ ] `scripts/ui/player_inventory.gd` (368L) — **REDESIGN**, fresh HTML/CSS
      hotbar+grid UI (informed by, not copied from, the old screen
      composition).
- [ ] `scripts/ui/item_tooltip.gd` (161L) — **REDESIGN**, "how to use this
      item" hint UI.
- [ ] `scripts/base_item.gd` (77L) — **REDESIGN**, base item contract as a TS
      interface/class.
- [ ] **NEW** — DM-vs-player inventory split (infinite DM inventory + a
      separate limited-stock player inventory the DM stocks; placing a block
      consumes 1 from the player's stock, default cap 9999). Entirely unbuilt
      in the old repo.
- [ ] **NEW** — pickaxe/block-health combat rework: pickaxe attacks remove 1
      health/sec from a targeted block, every voxel type needs a health
      value, health regenerates instantly when attack stops. Pairs with the
      hand-equipment-dependent dispatch noted in Phase 5. Entirely unbuilt.
- [ ] **NEW** — equip scheme: double-click = equip right hand, single-click =
      equip left hand, Ctrl+hotbar-number = right hand, Shift+wheel cycles
      right-hand selection once dual-hand hotbar exists. Entirely unbuilt.
- [ ] **DEFER** — item icon polish (rendered-emoji PNGs for non-block items;
      lower priority: real 3D-rendered cube icons for block items). Cosmetic,
      push to Phase 12.

## Phase 7 — Mod system v2

- [ ] `scripts/modding/mod_manager.gd` (184L) — **REDESIGN** per plan:
      registration happens per-world at `WorldRoom` instantiation, not once
      globally at boot.
- [ ] `mods/wood_plank/register.gd` (48L), `mods/plains_biome/register.gd`
      (27L) — **PORT** as reference/example mods, rewritten as TS mod
      packages.
- [ ] Carry forward: **fixed mod-id-base scheme** (`MOD_VOXEL_ID_BASE =
      1000`) — exists because an earlier append-only scheme caused real save
      corruption. Don't regress.
- [ ] **NEW** — missing-mod-blocks warning/repair system: detect on world
      load when a world references a mod-voxel id that's now missing or
      reassigned (real, described-as-silent-corruption data-integrity issue
      in the old repo, never built). Needs detection + an air-fallback +
      a UI link to re-enable the missing mod. Worth building correctly this
      time now that mods are properly per-world scoped.
- [ ] **DEFER** — in-game mod-toggle UI (currently hand-edited JSON in the
      old repo, still true here for v1 — fine for now, not permanent).
- [ ] Carry forward as design principle: new world generators should
      register as mods rather than being hardcoded into the catalog
      (aspirational in the old repo, never fully enforced — worth actually
      holding to this time).

## Phase 8 — DM tools

- [ ] `scripts/ui/dm_world_menu.gd` (359L) — **REDESIGN**, World CRUD UI.
- [ ] `scripts/items/structure_saver_item.gd` (210L),
      `structure_placer_item.gd` (241L), `scripts/items/saved_structure.gd`
      (45L) — **PORT/REDESIGN**.
- [ ] **NEW** — import old saved structures. These are Godot `.tres` resource
      files (not SQLite, unlike world voxel data), but `saved_structure.gd`'s
      shape is simple and fully known (size, pivot, flat voxel-id array) —
      a small parser for that resource format is enough to pull them into
      the new structure format, reusing content from the old repo's DM
      build-tool work.
- [ ] `scripts/items/plane_selector_item.gd` (118L) — **PORT/REDESIGN**.
- [ ] `scripts/pcg/build_session.gd` (64L) — **PORT/REDESIGN**, shared
      plane-select state.
- [ ] `scripts/items/enemy_spawn_egg_item.gd` (61L) — **REDESIGN**; depends
      on Phase 11's NPC work existing first.
- [ ] `levels/gridmap_rotation_tool.gd` (134L) — **DROP**. Godot-editor-only
      `@tool` script (MeshLibrary cell rotation in the editor); no equivalent
      concept in the new stack.
- [ ] **NEW** — draw tools, entirely unbuilt in the old repo:
      `DrawPointItem`, `DrawLineItem` (Bresenham), `DrawRectangleItem`
      (fill-vs-outline toggle, undecided in old TODO), `DrawCircleItem`.
      Open question carried from the old doc: reuse hotbar block selection
      or a dedicated picker for what a draw tool paints with?
- [ ] **NEW** — drawing persistence: serializable drawing resource (plane
      basis + sparse cell→voxel map), a "recent drawings" list UI, explicit
      save/load-into-plane actions. Unbuilt.
- [ ] **NEW** — volume generation: `ExtrudeItem` (input method — click vs.
      drag vs. numeric — undecided), `RevolveItem` (axis-picking needs
      design), `SweepItem` (most complex, old doc explicitly deferred this
      until extrude+revolve prove out). Unbuilt.
- [ ] **NEW** — plane per-corner resize/translate after creation, matching
      the structure-saver's modal-edit pattern. Unbuilt.
- [ ] **NEW/DEFER** — misc DM polish from the old TODO, none built: undo
      stack (~3 deep) for placements, structure-paste-overwrites-at-pivot
      behavior, structure name shown on billboard when cycling with **C**,
      copy the saved limestone tower into an example-structures slot.
- [ ] Standing architecture constraint from the old doc, still worth holding
      to: new tools should be new catalog entries, not special-cased
      branches; avoid hardcoding tool-specific logic into shared scene nodes.

## Phase 9 — Lighting + voxel tick system

- [ ] **NEW — design lighting fresh, don't port the old model.** Both of the
      old repo's lighting approaches were Godot-specific workarounds: pooled
      nearest-N real `OmniLight3D`s (`light_registry.gd`, 290L) because
      per-voxel emission wasn't cheaply available, and a CPU-painted
      `CHANNEL_COLOR` "GLOW" hack (`voxel_lighting.gd`, 50L) that was built
      and **fully reverted** after a chunk-format migration crash (old vs.
      newly-generated chunks had incompatible channel depth). Web needs to
      stay lightweight, and this time light-emitting voxels can likely just
      set real emissive material properties directly (Babylon materials
      support emissive color/texture natively) instead of routing through
      either of those workarounds. Treat both old files as reference for
      *what not to redo*, not as porting targets — design this against
      Babylon's actual material/lighting capabilities from scratch.
- [ ] Keep as fallback ideas if flat emissive materials aren't enough
      visually or for performance at scale: the pooled nearest-N dynamic
      light model, or the deferred real per-light occlusion idea below —
      but don't default to either without checking whether plain emission
      already looks right first.
- [ ] `scripts/sunsetter.gd` (95L) — **PORT** concept (occlusion-raycast to
      sun drives indoor/outdoor lighting transition).
- [ ] `scripts/pcg/voxel_tick_system.gd` (102L) — **PORT**, engine-agnostic
      (FullPeriodLCG-driven ambient tick).
- [ ] `scripts/pcg/world_check_tick.gd` (141L) — **REDESIGN**, repair sweep
      adapted to per-world SQLite storage.
- [ ] **DEFER** — real per-light-voxel occlusion (raycast each light to
      nearby voxels, boost only where unobstructed). Never attempted in the
      old repo (needed an engine recompile there) — the old blocker is moot
      under the new stack, so this may be worth a fresh look, just not
      urgently.
- [ ] Check early: does Babylon.js have the same transparent-depth-write
      quirk that forced an alpha-scissor-cutout workaround for glass/battle
      waypoint lines in Godot? If not, this whole workaround class may not
      be needed going forward.

## Phase 10 — Battle mode / turn tracker

- [ ] `scripts/battle/battle_mode_manager.gd` (341L) — **REDESIGN**, now
      genuinely server-authoritative (per plan).
- [ ] `scripts/battle/turn_tracker.gd` (51L) — **REDESIGN**, Colyseus
      `Schema` room state.
- [ ] `scripts/ui/turn_tracker_menu.gd` (250L) — **REDESIGN**; also fix two
      known old bugs while rebuilding: minimized state is too tall (should
      shrink to just the title bar), and minimized title text should read
      "`<X>`'s turn"/"Your Turn" directly instead of a static label plus
      duplicated info below.
- [ ] **NEW** — character size system, entirely unbuilt: mod-provided
      `PlayerInfo` size (plain voxel-count number), size-scaled wireframe
      waypoint markers (tiny/small/medium/large/huge), sub-voxel waypoint
      snapping for small characters, size-scaled wireframe box around the
      player in battle mode, a temporary target-reticle box on whatever's
      aimed at.
- [ ] **NEW** — respawn/last-safe-position should update to the player's
      last marked battle-mode waypoint when their turn ends. Needs
      combatants linked to real entities (old repo's `is_local_player` flag
      was a start, not finished).
- [ ] **Decide with the user**: should turn order actually be enforced this
      time? (Old repo deliberately didn't enforce it — this is a product
      decision, not an engineering default, per the architecture plan.)
- [ ] **NEW** — turn-based encounter auto-trigger on running into an enemy.
      Old TODO left the trigger condition, AI turn-mode switch, and
      end-of-encounter condition all unspecified — needs a real design pass,
      not just a port.
- [ ] **NEW** — dice roller, Tab character-action menu (spells/abilities,
      likely a character-sheet mod extending inventory). Never built.
- [ ] **DEFER** — line-of-sight lines from enemy to player. Blocked on
      Phase 11's AI entity existing; connects to the vision-cone work there.
- [ ] Note: waypoint cleanup across world-switch/death-respawn was never
      re-verified even in the old repo after force-enabled-intangible was
      removed — don't assume it's solid, re-check when porting.

## Phase 11 — NPC/AI

- [ ] `scripts/blob_ai_resource.gd` (687L) — **REDESIGN**, WANDER/CHASE/
      ATTACK/BOUNCING/STOP_AND_TURN state machine, server-owned per plan.
- [ ] `scripts/blob_ai_resourceold.gd` (851L) — **DROP**. Explicitly
      superseded legacy version kept alongside the active one; not a
      porting target.
- [ ] `scripts/ai_scripts/terrain_detection.gd` (406L) — **REDESIGN**,
      raycast-based ground/cliff/wall detection against noa's raycasting.
- [ ] `NPCs/evil_blob_ai.gd` (163L) — **REDESIGN**, ties the AI resource to
      a physical entity.
- [ ] `NPCs/blob_npc_base.gd` (9L) — **DROP**, trivial stub; its minimal
      gravity+move behavior is absorbed into the real NPC entity design.
- [ ] `NPCs/dialog_entry.gd` (9L), `NPCs/npc_dialog_system.gd` (240L) —
      **REDESIGN**, dialog data model + paging UI.
- [ ] Vision-cone mesh (per your correction to the original scoping — this
      is genuinely useful for stealth/NPC-attack-range, not just a debug
      visual): land the core FOV/LOS detection math **in this phase**
      (AI perception needs it regardless); defer rendering it back to
      players as a visible cone to Phase 12+ or its own item.
- [ ] **NEW** — puppet item (spawn a controllable-but-idle character),
      puppet-string item (interact to take control), a generic NPC entity
      beyond `evil_blob`, NPC-dialog-editor item. All entirely unbuilt.
- [ ] Note: `evil_blob.tscn`'s hand-node "Node not found" error (unset
      `ledge_grabber_path` export) is Godot-scene-specific and becomes moot
      on port — no action needed, won't carry forward.

## Phase 12+ — Polish

- [ ] `scripts/attribution.gd` (40L), `attribution_data.gd` (20L),
      `attribution_manager.gd` (20L) — **PORT** concept, low priority asset-
      credit tracking.
- [ ] `scripts/save_system.gd` (119L) — **DROP** as a literal port (per-world
      SQLite + the still-TBD account store already cover this per the plan);
      its "separate global save file" pattern may still inform account-level
      settings storage later.
- [ ] `scripts/singleton_global_lib_stuff/globals_main.gd` (23L) — **TBD**,
      read directly when this phase is actually reached (survey agent
      couldn't summarize specifics from a skim).
- [ ] `playable/pause_menu.gd` (361L), the settings-UI half of
      `scripts/game_settings.gd` — **REDESIGN**. Good opportunity to move off
      code-gen UI for real this time, per the "tolerated, not loved" feedback
      repeated in the old TODO doc itself.
- [ ] `levels/hud.gd` (160L) — **REDESIGN**.
- [ ] `menus/main_menu.gd` (19L), `menus/special_select.gd` (23L) —
      **REDESIGN**, trivial, low priority.
- [ ] `scripts/ui/ui_pause_gate.gd` (25L) — **RE-EVALUATE**. Ref-counted
      pause-gate pattern assumed single-player pause; open question whether
      "pause" makes sense at all in a shared multiplayer world before
      porting this concept.
- [ ] `scripts/biome_wind_controller.gd` (76L) — **PORT/REDESIGN**, low
      priority ambient polish.
- [ ] **DEFER** — glass voxel full connected-texture scope (neighbor-aware
      border merging). Explicitly deferred even in the old repo; two
      unconfirmed implementation approaches were identified but neither
      spiked. Low priority, real spike needed if ever revisited.
- [ ] **NEW/DEFER**, misc polish items from the old TODO, none resolved
      there: audit that all input goes through an action map (not hardcoded
      keycodes); purple skybox cubemap resolution bump (verify current value
      first, believed still 64, target 512); billboards tied to a held item
      should clean up on item change (currently linger); investigate/remove
      the unexplained tooltip pagination scrollbar; fix the `/`
      tooltip-toggle leaving mouse/input state stuck; world save-size display
      going stale until player death (root cause undiagnosed — likely needs
      periodic autosave regardless, for crash safety); confirm world save
      actually fires on plain game exit, not just world-switch.
- [ ] Chunk-streaming/meshing performance at real map sizes — already in the
      architecture plan, worth an early stress test given this is a
      DM-authored-map tool (potentially denser than typical survival voxel
      games).
- [ ] Google/OAuth login + payment-processor integration for cosmetics
      (3D dice, jiggle physics) — already flagged in the plan as its own
      later research track, not scoped further here.

## Cross-cutting / already resolved

- [x] `scripts/dev/dev_console.gd` (760L) — **DROP**, its function is fully
      superseded by `@colyseus/testing` (Phase 1, merged). No further
      porting needed.
- [ ] `scripts/ui/dev_console_ui.gd` (138L) — **DEFER**, no clear future home
      yet (the console's *function* moved to `@colyseus/testing`, but there's
      no in-browser visible debug console planned). Revisit only if one gets
      scheduled.
- [ ] TODO_web_multiplayer.md — **largely moot**. It's Godot-web-export
      research (the exact blocker that motivated this migration) — its
      actual open questions (server-authoritative model, scope of porting
      game-specific systems) are already resolved by the architecture plan
      and this checklist.

## Excluded entirely (not porting)

- `addons/` — third-party `script_splitter` editor plugin (~55 files),
  Godot-editor tooling only.
- `examples_dd3d/` — third-party demo/example content for a Godot addon.
- `levels/area_3d.gd` (7L) — trivial Godot `Area3D` glue.
- `playable/transparent_view.gd` — empty file (0 bytes).
- `scripts/backup_stuff.gd` (87L) — dead/commented-out scratch code.
- `scripts_dev/*.py` — Python dev scripts (texture/screenshot generation).
  Possibly still useful as engine-agnostic offline asset-prep tooling —
  worth a quick look later, not now, not part of the GDScript port itself.
