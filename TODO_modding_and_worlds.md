# Modding system, world switching, and new content

Branch: `feature/modding-system` (off fresh `master`, after `feature/3d-build-tools`
merged via PR #1).

Three asks, in priority order per your message -- modding infrastructure
first because it enables everything else to be built in isolation:

1. A real mod-loading system: mods live in a directory (`res://mods/` in the
   project, or `user://mods/` for actually-user-installed ones), each with a
   JSON manifest, and a JSON checklist that enables/disables them. Going
   forward, new features should default to being mods, not hardcoded into
   the base game, unless there's a reason not to.
2. World switching (Roll20-style pages), a DM menu to create new worlds
   picking from classified PCG generators (repeatable / non-repeatable /
   finite), a new finite limestone-slab generator, and shader work (panini
   removal, real skyboxes, depth-based skybox switching).
3. New voxels: a code-gen'd wood plank texture, and glass with edge-merging
   between adjacent glass voxels.

## Phase 0 -- Mod loading infrastructure (do first) [done, on feature/modding-system]

- [x] Mod directory layout: `res://mods/<mod_id>/` (bundled/dev, checked
      into git -- this is where the wood-plank proof-of-concept mod below
      lives) and `user://mods/<mod_id>/` (actually-user-installed, not
      checked in). Both scanned at boot.
- [x] Manifest: `mod.json` per mod folder -- id, name, version, entry
      script path (relative to the mod folder).
- [x] Enable/disable checklist: `user://mods_enabled.json`, a flat
      `{mod_id: bool}` map. Newly-discovered mods default to enabled and
      get added to the checklist automatically. No in-game toggle UI yet --
      "simple json checklist" was the explicit ask, editing the file by
      hand is fine for now.
- [x] `ModManager` autoload: discovers mods, loads the checklist, and for
      each *enabled* mod calls a `static func register(...)` on its entry
      script (loaded dynamically via `load(path).call("register", ...)` --
      mods aren't known at compile time so there's no class_name to
      reference directly).
- [x] Mod API surface (methods on `ModManager` mods call directly, since
      it's a globally-addressable autoload):
  - `register_item(entry: Dictionary)` -- same shape as `ItemCatalog`
    entries (kind/id/name/icon/item_script/hint). `ItemCatalog` merges
    built-ins with `ModManager.registered_items`.
  - `register_voxel(def: Dictionary)` -- name + a `VoxelBlockyModel`
    (built however the mod likes, e.g. procedurally). Mods run at boot,
    before any level with a `VoxelBlockyLibrary` exists, so these just
    queue up; `ModManager.apply_voxel_registrations(library)` actually
    appends them (assigning the next free integer id) the first time a
    level's library becomes available -- hooked from
    `player_inventory.gd`'s existing `_refresh_items()`, which already
    fetches the library each call. Idempotent (tracks which library
    instance it's already applied to) since `_refresh_items()` runs more
    than once (immediate + a 0.5s retry).
- [x] Toggling a mod off removes its content on the *next* launch, not
      live mid-session -- voxel registration mutates the shared library in
      place, so there's no clean way to retroactively un-append a model
      from an already-running level. This is a normal restart-to-apply
      convention for mod toggles, not trying to avoid; don't build
      hot-reload for this.
- [x] Proof of concept: the wood-plank voxel (see Phase 2) ships as a real
      mod under `res://mods/wood_plank/`, not hardcoded -- verifies the
      whole pipeline (discovery, checklist, dynamic voxel registration,
      catalog pickup) rather than just the plumbing in isolation.

Verified live end-to-end: headless boot logs `[ModManager] Loaded mod:
wood_plank` with zero new errors; `user://mods_enabled.json` auto-generated
correctly; the inventory grid showed a genuinely new icon (a procedurally
generated concentric wood-ring texture, distinct from the log/plank being
copied) with hover tooltip correctly resolving to "Wood Plank" / "Click to
place" (built-in DISPLAY_NAMES fallback to `ModManager.get_voxel_name()`
working); equipping and clicking placed it with no errors. Then flipped
`mods_enabled.json` to `false`, relaunched -- no "Loaded mod" log line, and
the inventory grid came back to exactly the pre-mod 21 items with the
wood-ring icon completely gone. Both the load and unload paths are for-real
confirmed, not just "should work."

## Phase 1 -- World switching + DM world creation [core switching done, on feature/modding-system]

- [x] Menu-level "pages" like Roll20 -- `WorldManager` autoload persists a
      worlds list to `user://worlds.json` ({id, name, generator_id,
      params}), `DMWorldMenu` (F1) lists them and switches via
      `get_tree().change_scene_to_file()` + a `pending_world` handoff read
      by `center_of_universe.gd._ready()` before the terrain streams any
      chunks.
- [x] DM menu: create a new world, picking a PCG generator from a
      classified list (`WorldGeneratorCatalog`):
  - **Repeatable**: same seed -> same world regardless of the path taken
    to generate it. The existing hilly-terrain generator already is this
    (chunk-based, deterministic per-chunk regardless of visit order).
  - **Non-repeatable**: order/path-dependent (e.g. wave function collapse,
    not built).
  - **Finite + repeatable**: fixed size, deterministic. The new limestone
    slab (below) is this.
  - Fine to leave a category with zero entries for now -- the
    classification is the point, not filling every bucket immediately.
- [x] New finite generator: a limestone slab, parameterized by
      width/height/depth (all limestone voxels, `VoxelTypes.LIMESTONE`).
      Player spawns centered above the slab (`LimestoneSlabGenerator.
      spawn_position()`), not inside/under it.
  - [x] Gets a distinct flat background color (not the default blue) so
        "you're in a different world" reads at a glance -- **explicitly a
        placeholder**, not a real skybox; see the follow-up right below,
        asked for specifically to prove the "real skybox" half of the
        panini-removal goal, not just a different flat color.

Verified live: F1 opens the menu over the existing "Hilly World"; selecting
Limestone Slab reveals width/height/depth fields with sane defaults;
Create & Switch reloads the scene into a new purple-sky slab world. (Your
words: "Good stuff. Sky very purple.")

### Follow-up -- real seamless skybox [done]

Flat purple proved the plumbing (generator swap, distinct env, spawn
override); replaced with a real procedurally generated *cubemap*
(`ProceduralSkybox.generate_cubemap()`), sampled by a custom
`shader_type sky` shader (`simple_cubemap_sky.gdshader`, `samplerCube` +
`EYEDIR`) -- seamless by construction since each face's color is a
continuous function of the 3D direction vector, not 6 independently-baked
images that need edge-matching. (`PanoramaSkyMaterial.panorama` turned out
to be typed `Texture2D` only, confirmed via doctool XML, so a plain
Cubemap resource wasn't an option -- this is why the custom shader.)
Verified live: limestone-slab worlds now show a seamless purple
procedural pattern, no visible seams at cube-face edges.

- [ ] **Checked -- not in the codebase, confirmed by grep across
      `scripts/`:** the poisson-disc-sampling-in-a-capsule +
      voxel-weighting idea for nice biome boundaries (see
      `example_pcg_capsule.py` at repo root -- the Python reference
      implementation, not yet ported to GDScript). Purely a future idea
      right now, no implementation to build on. GDScript, not C#, per
      your web-hosting note (Godot's HTML5/web export doesn't support
      Mono/C#). Logged here so it doesn't get lost, not attempting it
      this pass.
- [ ] F1-menu world display with colors per biome point, using Godot's
      own visuals (not VTK) -- depends on the capsule/biome system above
      existing first.
- [x] Panini removal: `panini_full.gdshader` (the player's own shader,
      `Blob.tscn`) turned out to already have zero panini code -- just two
      stale `shader_parameter/panini_d`/`panini_s` overrides in
      `Blob.tscn` pointing at uniforms that no longer existed in the
      shader, now deleted. `panini_sky.gdshader` (the default Hilly
      world's sky) had the actual distortion math, but it was already
      dead -- wrapped in a commented-out `if (panini_enabled > 0.5)`
      block referencing an undeclared `camera_transform` uniform, so it
      could never have run. Stripped the dead block and the now-unused
      `panini_d`/`panini_s` uniforms (plus their matching stale overrides
      in `voxel_main_world.tscn`), leaving a plain equirectangular
      panorama sky shader. The shared block shader every voxel material
      uses (`xray_if_behind_full.gdshader` -- `shader_dirt.tres`,
      `shader_grass.tres`, etc.) was already confirmed panini-free, so
      its cutout/x-ray-behind-terrain effect was never at risk. Net
      effect on the actual rendered sky: none (the code was inert), just
      cleanup -- both scenes' skies are now genuinely panini-free with no
      leftover confusion for the depth-based switch below to build on.
- [ ] Main world was supposed to have a Terraria-like depth-based skybox
      switch (different sky when underground vs. on the surface) -- not
      built yet, now unblocked since panini is fully removed.

### Follow-up -- Plains biome [done]

A second, simplified biome: the existing hilly generator reused via
`fixed_params` (`mods/plains_biome/`) rather than a new generator script --
`trees_enabled`/`windmills_enabled`/`height_scale` exports added to
`HillyTerrainGenerator`/`generator_main.gd`, Plains sets
`trees_enabled=false, windmills_enabled=false, height_scale=0.12`. Caught
and fixed iteratively: first pass only killed trees (peaks/windmills still
there, caught live), second pass flattened height + disabled windmills.
Also fatal on spawn at first -- landing above freshly-streaming terrain
that hadn't generated yet triggered `Health.gd`'s fall-damage curve
(`max_health = 1.0`, quadratic) before the player ever saw the world.
Fixed with a `_grant_spawn_protection()` helper in
`center_of_universe.gd` (zero velocity + briefly disable
`turn_on_fall_damage` after any generator-driven spawn teleport, not just
Plains' -- limestone-slab spawns get the same protection). Verified live:
flat treeless windmill-less landscape, player survives every spawn.

### Follow-up -- world deletion, reset, and persistence [done]

- [x] `WorldManager.delete_world(id)` / `reset_world(id)` /
      `get_stream_path(id)`: each world gets its own
      `user://world_saves/<id>.sqlite`; delete removes the world's
      `worlds.json` entry and its save file, reset removes just the save
      file (world regenerates fresh from its generator next load). World
      ids are derived from the max existing `world_N` suffix + 1, not
      `worlds.size()`, so a deleted-then-recreated world can't collide
      with an older world's still-on-disk save.
- [x] `dm_world_menu.gd`: right-click a world row for a Reset/Delete
      `PopupMenu`, or hover + press Delete. (Popup position bug found
      live: `DisplayServer.mouse_get_position()` is desktop-global and
      landed the popup off-window once the game window wasn't at the
      desktop origin -- fixed with `get_viewport().get_mouse_position()`,
      which is viewport-local, matching what an embedded-subwindow
      Popup's `position` actually expects.)
- [x] Per-world `VoxelStreamSQLite` wired into
      `center_of_universe.gd._apply_pending_world()` so voxel edits
      persist instead of regenerating fresh every switch. **Live-tested
      by you and initially found broken**: edits didn't survive an F1
      world switch. Root cause -- `VoxelTerrain` only flushes a modified
      block to its stream on unload or an explicit
      `save_modified_blocks()` call; `change_scene_to_file()` just frees
      the terrain node, neither happens automatically. Fixed by making
      `WorldManager.switch_to_world()` await a `_flush_current_world()`
      step first (`terrain.save_modified_blocks()`, then poll the
      returned `VoxelSaveCompletionTracker.is_complete()` per-frame)
      before reloading the scene. **Live-tested by you and confirmed
      working** -- but surfaced a second bug: dying ("Player died.
      Reloading...") used `get_tree().reload_current_scene()`, which
      re-instantiates the scene file's own baked-in default terrain
      (Hilly World) rather than whatever world you'd actually switched
      to. Fixed with `WorldManager.current_world` (kept up to date by
      `switch_to_world()`, defaulted to the first world at boot) and a
      `respawn_in_current_world()` entry point that
      `player_blob_ctrl.gd.die()` now calls instead -- reloads back into
      the same world (and gets the same flush + spawn-protection
      treatment as a manual F1 switch, since it's the same code path).
      Live-tested and confirmed working.
- [x] Fresh launch (no pending_world queued -- first boot, or the scene
      run directly) was still using the scene file's own baked-in default
      terrain instead of "the first existing world." `_apply_pending_world()`
      now falls back to `WorldManager.current_world` (defaults to
      `worlds[0]`) when `pending_world` is empty, so a fresh start always
      loads whichever world is actually first in the list.
- [x] Save file size shown per world in the DM menu list (e.g. "New World
      (limestone_slab)  [128.0 KB]", "no save data" before anything's
      been written) -- `WorldManager.get_save_size_string()`. Relevant to
      your multi-user/web-hosting note: raw file size is also exactly
      what you'd want to track/cap per-user if worlds are ever served
      from a shared host. Live-tested and confirmed: size grows with
      saved content (52 KB after building underground trees vs. 20 KB
      before) -- a hand-built battlemap-scale structure lands in the
      tens-of-KB range.
- [ ] Minor, deprioritized by you ("of less importance now"): some
      placed-voxel faces visually remain after deleting a neighboring
      voxel. Noted, not investigated.
- [ ] SpinBox max values for limestone-slab width/height/depth raised
      256/64/256 -> 100000/100000/100000 (was never a real generator
      limit, just an arbitrary UI cap coincidentally close to
      `VoxelTerrain.max_view_distance = 256`, a separate streaming/
      performance setting that was left untouched).
- [x] `voxel_id` param (type `"voxel_picker"`) added to the limestone-slab
      generator so a DM can pick which block (built-in or mod-added) fills
      the slab -- `dm_world_menu.gd` populates the picker from
      `VoxelCatalog.get_placeable_voxels()` after
      `ModManager.apply_voxel_registrations()`. Boot-checked clean;
      **not yet live-tested** (pick a non-default/mod block, confirm the
      slab generates from it).

### Follow-up -- screenshot token cost

`scripts_dev/shrink_screenshot.py`: PIL-based downscale/crop CLI (opencv
is installed but broken system-wide -- `libprotobuf.so.34.1.0` missing,
a version mismatch against the `.31.1.0`/`.35.1.0` actually installed, not
a missing package -- substituted PIL rather than fixing a system lib).
~1330 tokens -> ~240 tokens per screenshot at the default 400px width,
confirmed still legible. Use this for every screenshot going forward
instead of reading full-resolution captures.

## Phase 2 -- New voxels, both as mods (Phase 0 dependency)

- [x] Wooden plank: `res://mods/wood_plank/`. Code-generated texture
      (`Image`/pixel-level, not hand-drawn) resembling the *inner rings*
      pattern of the existing log texture, not a plank-grain look --
      matching what was asked, even though "plank" more typically implies
      flat straight grain. Done as part of Phase 0 (it's the mod-system
      proof of concept).
- [ ] **Convention for later:** the next new world type (the capsule/
      biome system, or anything else) should ship as a mod registering a
      generator via `ModManager.register_generator()` (the `plains_biome`
      pattern), not get hardcoded into `WorldGeneratorCatalog.get_generators()`
      the way `hilly`/`limestone_slab` currently are -- those two are
      grandfathered in as the original built-ins, not a precedent to keep
      copying.
- [ ] Glass: `res://mods/glass/`. Fully transparent except the edges,
      which are white-blue and mostly (not fully) transparent. **Two
      distinct problems, corrected after initially conflating them:**
  - **Shared-face culling** (don't draw the 2 mutually-hidden faces where
    two touching glass cubes meet) -- a real, separate optimization,
    `culls_neighbors`/`transparency_index` on `VoxelBlockyModel` (found
    while building wood_plank) is plausibly still the mechanism for this
    specific part. Still unconfirmed by actual testing.
  - **Border-texture merging** (the actual "reads as one continuous pane"
    ask) is a different problem `culls_neighbors` does *not* solve: each
    glass face has a border/frame texture, and where two glass cubes
    touch, the border segment *on the 4 side faces adjacent to that seam*
    (4 faces per cube, 8 total) needs to drop the piece of frame running
    along that specific shared edge -- otherwise you still see a seam
    line even though the two internal faces are culled. A face's 4 edges
    each border a different orthogonal neighbor (e.g. the top face's 4
    edges border north/south/east/west, not up/down), so which edges of
    a border texture are "missing" depends on that face's own neighbors
    independently per edge -- 16 raw combinations, but by rotating a
    texture 90 degrees at a time, the combinations collapse to 6 base
    textures covering every case (grouped by *how many* edges are
    missing, not just which): 0 missing (1 texture), 1 missing (1
    texture x4 rotations), 2 missing adjacent/"L-shaped" (1 texture x4
    rotations), 2 missing opposite (1 texture x2 meaningful rotations),
    3 missing (1 texture x4 rotations), 4 missing/fully bare (1 texture).
  - Architecturally this is the hard part: `VoxelMesherBlocky` maps one
    static `VoxelBlockyModel` per integer voxel id -- it doesn't have a
    built-in notion of "pick a texture based on this instance's
    neighbors" the way Minecraft's connected-textures/blockstate systems
    do. Two plausible approaches, neither confirmed yet: (a) a custom
    mesher that inspects neighbors per-chunk at mesh-build time and
    selects UVs dynamically (bypasses the per-id static model system
    entirely), or (b) pre-register a glass "variant" voxel id for each of
    the distinct border states needed and have block-place/break logic
    rewrite a glass voxel's own id (and its neighbors') whenever
    adjacency changes, closer to how Minecraft actually implements
    connected glass panes/fences. (a) is more general but a bigger lift;
    (b) fits the existing "one id, one fixed model" architecture better
    but means placing one glass block can require rewriting several
    neighboring voxels' ids too. Needs a real spike before committing to
    either, not assumed solvable the same way as an ordinary opaque or
    single-texture cutout block.

## Phase 3 -- TTRPG modes (new subject)

Full ask: a turn-based battle mode alongside the existing default movement
mode, where you travel as a transparent-you and mark voxels to travel to
with running Euclidean/Manhattan distance shown; Tab shows character
actions (spells/abilities -- possibly items under the hood, maybe via a
character-sheet mod); line-of-sight from enemies to player as lines rather
than the sneak-mode frustums; a dice roller; a DM-facing turn tracker; and
a default-mode cursor readout showing distance to whatever you're looking
at (range-check info). This first pass covers the mode switch, movement,
turn tracker, and cursor distance -- actions/character-sheet, LOS lines,
and dice roller are still ahead.

- [x] Battle mode switch: `BattleModeManager` autoload, `toggle_battle_mode`
      (B). Built on top of the DM-mode fly/intangible movement that
      already existed in `player_blob_ctrl.gd` (double-tap Space / double-
      tap Ctrl) rather than a new flight controller -- battle mode just
      force-enables both (`is_flying`/`is_intangible`) instead of
      requiring the double-tap, and drops the Blob's shader
      `albedo_color.a` to 0.35 for the "transparent you" look, restoring
      both on exit.
- [x] Movement/waypoint marking: while battle mode is active, the
      primary/secondary item-use clicks are repurposed
      (`two_handed_resource.gd` checks `BattleModeManager.active` first)
      to mark the player's current position as a waypoint (LMB) or undo
      the last one (RMB), instead of using the held item. Small unshaded
      yellow sphere markers are spawned at each waypoint in the world
      (`BattleModeManager._refresh_markers()`) so the planned path is
      actually visible, not just a HUD number. Total distance shown both
      ways (Euclidean straight-line and Manhattan grid-step, since which
      one matters depends on the table's rules) in a HUD label
      (`hud.gd`).
- [x] DM turn tracker, redesigned after first live test: not a modal F2
      panel anymore -- an always-on-screen, draggable, minimizable widget
      (Roll20-style, per your explicit correction), `turn_tracker_menu.gd`,
      no dedicated open/close key at all (the `toggle_turn_tracker`/F2
      input action was removed). Drag by its title bar to reposition;
      minimize collapses it to a compact "<name>'s turn" / "Your Turn"
      bar. `TurnTracker` autoload still holds the actual data (in-memory
      combatant list + current-turn index + round counter, not persisted).
      Combatants can now carry `is_local_player: bool`; the player got a
      `character_name` export (`player_blob_ctrl.gd`), and an "Add Me"
      button adds the local player by that name -- when it's their turn,
      the widget shows "Your Turn" in a distinct color instead of
      "<name>'s turn". Clicking a character in the world to add them (with
      an eventual initiative roll) is noted but not built -- there's only
      the one local player to click on right now, no NPCs yet; "Add Me" is
      the pragmatic stand-in until that's worth building.
- [x] Range check moved from default mode to **battle mode only** (it's
      combat range-check info, not general sightseeing -- your correction
      after the first live test) and reimplemented on `VoxelTool.raycast()`
      -- the same mechanism `voxel_interactor.gd`'s place/delete targeting
      already uses -- instead of a generic `PhysicsDirectSpaceState3D`
      query, which was intermittent (the voxel-native raycast "always
      works" per how reliable block placement already is). Same origin
      (camera) and direction as before; distance is measured from the
      player's own position, not the camera, since that's what a TTRPG
      range/spell check actually cares about. Can't hit the player's own
      body by construction (VoxelTool.raycast only intersects voxel
      geometry), so no separate self-exclusion was needed the way the old
      physics-raycast version required.
- [x] Fixed a real crash found on first live test: `set_active()` assigned
      an untyped array literal (`[player.global_position] if player else
      []`) to the typed `waypoints: Array[Vector3]` var, which throws at
      runtime ("Trying to assign an array of type Array to a variable of
      type Array[Vector3]"). Now uses `clear()` + `append()`.
- [x] Fixed WASD moving the player while typing into a menu's text field
      (found via the turn tracker's "Combatant name" field, but the same
      gap existed in `dm_world_menu.gd`'s "Name" field too) --
      `player_blob_ctrl.gd` reads movement input directly every physics
      frame regardless of mouse mode, so releasing the mouse for a text
      field wasn't enough. Both now request `get_tree().paused` through a
      new `UiPauseGate` autoload (dm_world_menu.gd while open,
      turn_tracker's name field while focused) rather than setting
      `get_tree().paused` directly -- a single shared boolean would let
      one of them closing/losing focus incorrectly unpause while the
      other still wants it (e.g. DM menu open + turn tracker name field
      focused at once). `WorldManager.switch_to_world()` now calls
      `UiPauseGate.release_all()` up front, since `paused` (and the gate's
      own reasons dict, being an autoload) persists across
      `change_scene_to_file()` -- without it, a world switched-to while
      paused would load already frozen.
- [x] Two bugs found on first live test of the redesigned tracker: (1)
      "Next Turn" updated `TurnTracker.current_index` correctly (proven by
      clicking Minimize immediately after showing the right state) but the
      on-screen list/round label didn't visually update from the click
      itself -- root cause not fully confirmed statically, so every
      tracker button that mutates state (Next Turn, Clear All, Add, Add
      Me, Remove) now also calls `_refresh()` directly as a defensive
      redundancy alongside the signal-driven refresh, rather than relying
      on the signal chain alone. (2) Tab could no longer close the
      inventory menu -- it was cycling keyboard focus between the turn
      tracker's own buttons instead, since they default to focusable
      (`FOCUS_ALL`) and Godot's built-in Tab-for-focus-navigation consumes
      the key before it reaches `toggle_inventory`'s `_unhandled_input`
      handler. All the tracker's buttons are now `FOCUS_NONE` (mouse
      clicks still work fine, focus_mode only affects keyboard/gamepad
      navigation) -- only the "Combatant name" LineEdit still needs
      focus, and it does still call `grab_focus()` after Add for rapid
      multi-entry, so Tab could in principle still be at some risk right
      after adding a combatant specifically; worth confirming this didn't
      just narrow the window rather than close it.
- [ ] Still an open question from before: does force-enabling intangible
      mid-battle-mode ever strand the player inside terrain when it turns
      back off at end of turn (a pre-existing risk of the manual
      double-tap toggle too, not new, but worth confirming battle mode
      doesn't make it easy to trigger by accident); do the waypoint
      markers clean up correctly across a world switch/death-respawn.
- [ ] Not started: Tab character-action menu (Tab is currently bound to
      `toggle_inventory` -- likely the right foundation to extend via a
      character-sheet mod rather than a wholly separate panel, since
      actions/spells were described as "might be technically items"), line-
      of-sight lines from enemy to player (blocked on there being an actual
      enemy/AI entity to draw from -- `blob_ai_resource.gd` exists but
      hasn't been checked for fit), dice roller, initiative rolling +
      click-to-add-a-character-from-the-world for the turn tracker.
