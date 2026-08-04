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

### Follow-up -- real seamless skybox (in progress, this turn)

Flat purple proved the plumbing (generator swap, distinct env, spawn
override) but not "actual skyboxes" -- want a real procedurally generated,
seamless *cubemap* image (not just a color) to prove that half properly:
6 square textures where each pair of adjacent faces' touching edge pixels
match, so there's no visible seam at the cube corners. Godot's
`PanoramaSkyMaterial` wants a single equirectangular `Texture2D`, not 6
separate face images directly -- need to confirm the actual Godot-side
mechanism (bake 6 procedural faces into one equirect image at generation
time server-side, vs. a `Cubemap`/`TextureLayered` resource, vs. a custom
sky shader sampling `samplerCube`) before committing to an approach.
- [ ] **Checked -- not in the codebase, confirmed by grep across
      `scripts/`:** the poisson-disc-sampling-in-a-capsule +
      voxel-weighting idea for nice biome boundaries. Purely a future
      idea right now, no implementation to build on. Logged here so it
      doesn't get lost, not attempting it this pass.
- [ ] Panini removal: **checked** -- panini distortion lives only in
      `panini_full.gdshader` (the player's own shader, `Blob.tscn`) and
      `panini_sky.gdshader` (presumably the skybox). The shared block
      shader every voxel material uses (`xray_if_behind_full.gdshader` --
      `shader_dirt.tres`, `shader_grass.tres`, etc. all reference it) has
      no panini code at all; its cutout/x-ray-behind-terrain effect (the
      thing explicitly called out as critical to keep) is safe by
      construction, not something that needs careful untangling. So this
      is scoped to just the two panini-named shaders. Removing panini
      distortion is also what makes real skyboxes (as opposed to whatever
      panini did to sky rendering) possible -- ties directly into the
      limestone slab's distinct sky
      and the depth-based switch below.
- [ ] Main world was supposed to have a Terraria-like depth-based skybox
      switch (different sky when underground vs. on the surface) -- not
      built yet, logged as follow-up once plain skyboxes exist at all.

## Phase 2 -- New voxels, both as mods (Phase 0 dependency)

- [x] Wooden plank: `res://mods/wood_plank/`. Code-generated texture
      (`Image`/pixel-level, not hand-drawn) resembling the *inner rings*
      pattern of the existing log texture, not a plank-grain look --
      matching what was asked, even though "plank" more typically implies
      flat straight grain. Done as part of Phase 0 (it's the mod-system
      proof of concept).
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
