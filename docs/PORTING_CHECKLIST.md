# Porting checklist: old Godot repo → ttrpg3d

Working, file-by-file breakdown of every `.gd` file in the old repo
(`/home/simleek/gamedev/ttrpg-3d`, 83 files / 13,122 lines, `addons/` and
`examples_dd3d/` excluded as third-party), plus every still-open item from
that repo's four `TODO_*.md` docs, organized against the phases in
[`docs/ROADMAP.md`](ROADMAP.md). The old repo stays untouched and readable
for the duration of the port (it's also preserved on GitHub as
`SimLeek/ttrpg3d-godot-old`) — **delete a file from the old repo only after
its port lands here and is verified**, not before, so there's always a
reference copy one `git log` away.

**Only open/in-progress work lives here.** Finished items are moved out to
[`docs/COMPLETED.md`](COMPLETED.md) (verbatim, with their full history/
rationale) as soon as they're done, specifically so this file stays
scannable for "what's actually left" — don't re-add a done item here, and
don't let a phase's open items pile up behind a wall of finished ones.
Each phase below links to its own section there for what already shipped.

**Phases are sequenced by playtest visibility, not by risk/dependency
order.** A prior version of this checklist had a standalone "low-risk
data/math ports" phase early on, on the theory that zero-dependency pure
functions are easy, safe wins to bank first — in practice this was
backwards: those functions (an LCG, a spatial hash, distance math, the
voxel type table) are *inputs* to Phase 4/8/9's systems, invisible and
unverifiable on their own until something actually uses them. Each now
lives in the phase that actually makes it show up during play.

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

## Phase 2 — MVP [PARTIAL]

Core walk/sprint/jump/fall/swim/zoom, the xray-cutout shader, and the
movement-provider seam are all done — see
[COMPLETED.md#phase-2--mvp](COMPLETED.md#phase-2--mvp).

- [ ] `wall_jump_resource.gd`, `ledge_safety_resource.gd`/`playable/
      ledge_grabber.gd`, `stair_stepper_resource.gd` — **NOT STARTED**.
      Scoped as their own future `MovementProvider` implementations
      (packages/client/src/movement/MovementProvider.ts, core/mod-
      boundary PR), the same pattern `NoclipFlyProvider` established, not
      special-cased into `CoreMovementProvider`.

## Phase 3 — Real world management [PARTIAL]

Per-world storage, the Game/World split, the real generator catalog
(hilly/plains/limestone_slab), and the in-game world-create/switch UI are
all done — see
[COMPLETED.md#phase-3--real-world-management](COMPLETED.md#phase-3--real-world-management).

- [ ] `scripts/pcg/voxel_types.gd` (194L) — **PORT** the ~20 types actually
      wired to a display name/model today (not all ~59 reserved constants)
      — the real terrain generator needs more than one material.
- [ ] `scripts/pcg/generator_main.gd` (41L) — **DROP**. Pure
      `VoxelGeneratorScript` passthrough glue for Godot's generator plugin
      system; no equivalent indirection needed in TS.
- [ ] `scripts/pcg/structure.gd` (3L) — **PORT** trivial data holder.
- [ ] `scripts/pcg/tree_generator.gd` (73L) — **PORT** algorithm.
- [ ] `scripts/pcg/windmill_generator.gd` (109L) — **PORT** algorithm.
- [ ] `scripts/pcg/modified_block_tracker.gd` (73L) — **REDESIGN**, mostly
      done: the new SQLite `chunks` table already only stores edited
      chunks (the same dirty-chunk-tracking intent), covered by
      `storage.ts`'s existing tests.
- [ ] `scripts/pcg/voxel_catalog.gd` (74L) — **REDESIGN**, catalog discovery
      moves from "scan a VoxelBlockyLibrary" to "read the shared TS voxel
      type table."
- [ ] `scripts/world/procedural_skybox.gd` (56L) — **PORT** the
      direction→color algorithm, rebuild the actual sky as a Babylon shader.
      Not touched by the games-and-world-generators PR -- still just the
      scene's default sky for every world. Found while researching that PR:
      the old game only ever special-cased the sky for ONE generator id
      (`levels/center_of_universe.gd`'s own `if gen_def.get("id","") ==
      "limestone_slab"`, a purple procedural sky; every other type,
      including "plains," kept the default `panini_sky.gdshader`) -- a
      single hardcoded if-check, not a real per-generator sky config.
      Worth deciding whether to port that exact hardcoded special case or
      design a cleaner per-generator sky hook when this is actually built.
- [ ] ADMIN-GRANT UI — still NOT built. `store.ts` has the real plumbing
      (`grantGameAdmin`, renamed from `grantAdmin` to operate on games),
      just no clickable UI calling it yet -- genuinely separate from
      "create/switch pages," a small, focused follow-up.
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
      they're free, already-designed content, not just test data.
- [ ] **NEW** (2026-10-11, user decision) — default world generator: switch
      to the less-hilly preset. Aesthetics/marketability driven, not a
      gameplay change -- screenshots are selling material (reference images
      saved under `~/claude_code/cad_pics`: `ttrpg3dgame.png` is the current
      hilly default, `ttrpg3dgame-newdef.png` is the less-hilly one to
      switch to). TODO: find the actual default-generator wiring and swap
      it; not done yet.

## Phase 4 — Voxel interaction [PARTIAL]

Movement moved to Phase 2. Multi-block-type placement, the real hotbar/
inventory, and the character-overlap placement guard are done — see
[COMPLETED.md#phase-4--voxel-interaction](COMPLETED.md#phase-4--voxel-interaction).

- [ ] `scripts/input/input_controller.gd` (257L) — **PARTIAL**. Only its
      core reference-counted `request_capture`/`release_capture`/
      `is_captured` mechanism is ported (`packages/client/src/
      inputCapture.ts`), pulled forward because the hotbar's inventory
      grid is a real, current consumer (suspends noa's pointer-lock
      mouse-look while open). Its gesture/sequence-matching, double-tap
      detection, and event-replay/batching layers are NOT ported -- no
      consumer for any of that yet.
- [ ] `scripts/two_handed_resource.gd` (66L), `playable/
      left_hand_gripper.gd` (201L) — **PARTIAL, by design**. Dual-hand
      primary/secondary routing and a real `HandController` object are
      NOT ported -- there's no second meaningful thing to hold yet (no
      empty-hand-interact, no pickaxe), so it'd be pure added complexity
      with no current payoff. `voxelEditor.ts` reads the hotbar's single
      equipped item directly instead. Revisit once a second item kind
      (pickaxe, etc., Phase 5/9) actually needs dispatching to a specific
      hand. Hand-equipment-dependent dispatch (empty=interact,
      pickaxe=attack, block=place) still NOT built -- there's only
      place/break today, unchanged from before this phase.
- [ ] `playable/squeezer_rays.gd` (119L) — **REDESIGN**, low priority within
      this phase (tight-space movement slowdown, not core movement feel).
- [ ] `scripts/items/phasing_gloves_item.gd` (20L), `wings_item.gd` (27L) —
      **PARTIAL**: the underlying capability is done
      (`NoclipFlyProvider`, see COMPLETED.md's Phase 2 entry), but it's
      only reachable via the GM admin-override toggle today, not an
      actual hotbar item a non-admin player could find/equip the way the
      old game had it -- that item-based unlock is still open.
- [ ] `playable/health.gd` (59L) — **REDESIGN, not a port**: this was
      built for the old game's stealth-platformer, not a TTRPG --
      confirmed by design discussion, not guessed. A real TTRPG health
      model needs to be character-sheet-based (per-character/per-system
      stats, not a fixed stamina-style regen curve), and per the
      core/mod-boundary's core/mod split this is combat/health
      DEFAULT-MOD territory, not core engine code. Still not needed yet --
      no damage source exists (combat/pickaxe-attack is Phase 5's own
      unbuilt scope).
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
      before this phase's movement work depends on it.

## Phase 5 — Inventory/items [PARTIAL]

Item catalog + hotbar pulled forward into Phase 4, done — see
[COMPLETED.md#phase-5--inventoryitems](COMPLETED.md#phase-5--inventoryitems).

- [ ] `scripts/ui/item_tooltip.gd` (161L) — **REDESIGN**, "how to use this
      item" hint UI. Still not built -- hotbar.ts uses a plain `title`
      attribute as a stand-in, not this.
- [ ] `scripts/base_item.gd` (77L) — **REDESIGN**, base item contract as a TS
      interface/class. `packages/shared/src/items.ts`'s `Item` tagged union
      covers today's one item kind (`place-block`); this entry is about the
      more general base contract once a second kind (pickaxe, etc.) exists.
- [ ] **NEW** — DM-vs-player inventory split (infinite DM inventory + a
      separate limited-stock player inventory the DM stocks; placing a block
      consumes 1 from the player's stock, default cap 9999). Entirely unbuilt
      in the old repo. Still unbuilt here too -- every item has unlimited
      "ammo" for now.
- [ ] **NEW** — pickaxe/block-health combat rework: pickaxe attacks remove 1
      health/sec from a targeted block, every voxel type needs a health
      value, health regenerates instantly when attack stops. Pairs with the
      hand-equipment-dependent dispatch noted in Phase 4. Entirely unbuilt.
      Default-mod territory per `docs/ROADMAP.md`'s core/mod boundary
      (combat rules, not core engine code) -- the GM admin-override escape
      hatch's instant build/delete (core/mod-boundary PR, Phase 4) already
      bypasses this kind of thing for an admin, so this is specifically
      about non-admin player-character pickaxe use.
- [ ] **NEW** — equip scheme: double-click = equip right hand, single-click =
      equip left hand, Ctrl+hotbar-number = right hand, Shift+wheel cycles
      right-hand selection once dual-hand hotbar exists. Entirely unbuilt --
      Phase 4 shipped only a single equip slot (see that phase's
      two_handed_resource/left_hand_gripper entry for why).

## Phase 6 — Mod system v2 [PARTIAL]

Scope grew beyond the old game's own mod system during the core/mod-
boundary PR (Phase 4): `mod_manager.gd` was purely DATA-mods (voxel
types, biomes) — this project's actual pitch ("roll20 for any tabletop
system," see `docs/ROADMAP.md`'s Standing Decisions) also needs
BEHAVIOR-mods (movement rules, combat, respawn policy), which the old
game never had any equivalent of. The core/mod-boundary PR built the
minimal seam for one of those (`MovementProvider`) plus two core-vs-
policy splits (GM powers, respawn) as a proof of concept — none of the
actual DYNAMIC mod-loading/config/UI machinery below exists yet; that's
still this phase's full scope.

- [ ] `scripts/modding/mod_manager.gd` (184L) — **REDESIGN**: registration
      happens per-world at `WorldRoom` instantiation, not once globally at
      boot. Needs to cover behavior-mod registration (`MovementProvider`
      and future equivalents for combat/respawn-policy), not just the old
      game's data-only (voxel type/biome) mod shape.
- [ ] `mods/wood_plank/register.gd` (48L), `mods/plains_biome/register.gd`
      (27L) — **PORT** as reference/example mods, rewritten as TS mod
      packages.
- [ ] Carry forward: **fixed mod-id-base scheme** (`MOD_VOXEL_ID_BASE =
      1000`) — exists because an earlier append-only scheme caused real save
      corruption. Don't regress.
      **Found live, R&D session**: this project's current chunk voxel
      format (packages/shared's encodeChunk/decodeChunk, and the SQLite
      BLOB storage) is a single byte per voxel (Uint8Array) end to end,
      capping real ids at 255 -- confirmed by a real bug (MARKER briefly
      at id 998, silently wrapped to 230 on every write, found via a
      saved chunk's actual byte histogram). `MOD_VOXEL_ID_BASE=1000`
      can't work as-is against this format; whichever phase builds the
      mod system needs to widen the wire format (Uint16Array, most
      likely) before or alongside it, not just reserve the id range.
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

## Phase 7 — DM tools [NOT STARTED]

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
      on Phase 10's NPC work existing first.
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

## Phase 8 — Lighting + voxel tick system [NOT STARTED]

The real Babylon-vs-Godot transparent-depth-write question is answered —
see [COMPLETED.md#phase-8--lighting--voxel-tick-system](COMPLETED.md#phase-8--lighting--voxel-tick-system).

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
- [ ] `scripts/pcg/spatial_hash_3d.gd` (112L) — **PORT**, *only if* the
      emissive-material approach above isn't enough and the pooled
      nearest-N dynamic light fallback is actually needed (it was
      `light_registry.gd`'s lookup structure) — don't port ahead of
      knowing that.
- [ ] Keep as fallback ideas if flat emissive materials aren't enough
      visually or for performance at scale: the pooled nearest-N dynamic
      light model (needs the spatial hash above), or the deferred real
      per-light occlusion idea below — but don't default to either without
      checking whether plain emission already looks right first.
- [ ] `scripts/sunsetter.gd` (95L) — **PORT** concept (occlusion-raycast to
      sun drives indoor/outdoor lighting transition).
- [ ] `scripts/pcg/full_period_lcg.gd` (89L) — **PORT** near-verbatim —
      drives the ambient tick below.
- [ ] `scripts/pcg/voxel_tick_system.gd` (102L) — **PORT**, engine-agnostic
      (FullPeriodLCG-driven ambient tick).
- [ ] `scripts/pcg/world_check_tick.gd` (141L) — **REDESIGN**, repair sweep
      adapted to per-world SQLite storage.
- [ ] **DEFER** — real per-light-voxel occlusion (raycast each light to
      nearby voxels, boost only where unobstructed). Never attempted in the
      old repo (needed an engine recompile there) — the old blocker is moot
      under the new stack, so this may be worth a fresh look, just not
      urgently.

## Phase 9 — Battle mode / turn tracker [NOT STARTED]

- [ ] `scripts/game_settings.gd` (198L) — **PORT** the Minkowski-norm
      distance math only (the Godot-autoload settings-persistence half
      moves to Phase 11+, client-side settings UI) — drives the
      battle-mode/HUD distance readouts below.
- [ ] `scripts/battle/battle_mode_manager.gd` (341L) — **REDESIGN**, now
      genuinely server-authoritative (per plan). Its M/N waypoint-mark/
      undo actually TELEPORTS the player between marked waypoints — use
      `PlayerController.teleportTo` (core/mod-boundary PR,
      `packages/client/src/movement/PlayerController.ts`) for that, the
      same entry point `respawnControl.ts` already calls; don't build a
      second position-forcing mechanism for this.
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
      Phase 10's AI entity existing; connects to the vision-cone work there.
- [ ] Note: waypoint cleanup across world-switch/death-respawn was never
      re-verified even in the old repo after force-enabled-intangible was
      removed — don't assume it's solid, re-check when porting.

## Phase 10 — NPC/AI [NOT STARTED]

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
- [ ] Vision-cone mesh (genuinely useful for stealth/NPC-attack-range, not
      just a debug visual): land the core FOV/LOS detection math **in this
      phase** (AI perception needs it regardless); defer rendering it back
      to players as a visible cone to Phase 11+ or its own item.
- [ ] **NEW** — puppet item (spawn a controllable-but-idle character),
      puppet-string item (interact to take control), a generic NPC entity
      beyond `evil_blob`, NPC-dialog-editor item. All entirely unbuilt.
- [ ] Note: `evil_blob.tscn`'s hand-node "Node not found" error (unset
      `ledge_grabber_path` export) is Godot-scene-specific and becomes moot
      on port — no action needed, won't carry forward.

## Phase 11+ — Polish [NOT STARTED]

- [ ] `scripts/attribution.gd` (40L), `attribution_data.gd` (20L),
      `attribution_manager.gd` (20L) — **PORT** concept, low priority asset-
      credit tracking.
- [ ] `scripts/save_system.gd` (119L) — **DROP** as a literal port (per-world
      SQLite + the account store already cover this); its "separate global
      save file" pattern may still inform account-level settings storage
      later.
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
- [ ] `scripts/ui/dev_console_fade_state.gd` (29L) — **DEFER**. Pure,
      testable fade-alpha math for a debug-console UI, but the dev
      console's *function* is already superseded by `@colyseus/testing`
      (Phase 1, done) and no in-browser debug-console UI is currently
      planned. Only relevant if one gets scheduled.
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
- [ ] Chunk-streaming/meshing performance at real map sizes — this is a
      DM-authored-map tool, potentially denser than typical survival voxel
      games, worth an early stress test rather than an assumption.
- [ ] Google/OAuth login + payment-processor integration for cosmetics
      (3D dice, jiggle physics) — its own later research track, not scoped
      further here.

## Cross-cutting / already resolved

`dev_console.gd` is fully superseded — see
[COMPLETED.md#cross-cutting](COMPLETED.md#cross-cutting).

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
