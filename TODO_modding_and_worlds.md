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

## Phase 0 -- Mod loading infrastructure (do first)

- [ ] Mod directory layout: `res://mods/<mod_id>/` (bundled/dev, checked
      into git -- this is where the wood-plank proof-of-concept mod below
      lives) and `user://mods/<mod_id>/` (actually-user-installed, not
      checked in). Both scanned at boot.
- [ ] Manifest: `mod.json` per mod folder -- id, name, version, entry
      script path (relative to the mod folder).
- [ ] Enable/disable checklist: `user://mods_enabled.json`, a flat
      `{mod_id: bool}` map. Newly-discovered mods default to enabled and
      get added to the checklist automatically. No in-game toggle UI yet --
      "simple json checklist" was the explicit ask, editing the file by
      hand is fine for now.
- [ ] `ModManager` autoload: discovers mods, loads the checklist, and for
      each *enabled* mod calls a `static func register(...)` on its entry
      script (loaded dynamically via `load(path).call("register", ...)` --
      mods aren't known at compile time so there's no class_name to
      reference directly).
- [ ] Mod API surface (methods on `ModManager` mods call directly, since
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
- [ ] Toggling a mod off removes its content on the *next* launch, not
      live mid-session -- voxel registration mutates the shared library in
      place, so there's no clean way to retroactively un-append a model
      from an already-running level. This is a normal restart-to-apply
      convention for mod toggles, not trying to avoid; don't build
      hot-reload for this.
- [ ] Proof of concept: the wood-plank voxel (see Phase 2) ships as a real
      mod under `res://mods/wood_plank/`, not hardcoded -- verifies the
      whole pipeline (discovery, checklist, dynamic voxel registration,
      catalog pickup) rather than just the plumbing in isolation.

## Phase 1 -- World switching + DM world creation

- [ ] Menu-level "pages" like Roll20 -- switch between worlds without
      restarting the game store the levels list somewhere; the DM menu
      needing to list/switch/create them wants a home).
- [ ] DM menu: create a new world, picking a PCG generator from a
      classified list:
  - **Repeatable**: same seed -> same world regardless of the path taken
    to generate it. The existing hilly-terrain generator already is this
    (chunk-based, deterministic per-chunk regardless of visit order).
  - **Non-repeatable**: order/path-dependent (e.g. wave function collapse,
    not built).
  - **Finite + repeatable**: fixed size, deterministic. The new limestone
    slab (below) is this.
  - Fine to leave a category with zero entries for now -- the
    classification is the point, not filling every bucket immediately.
- [ ] New finite generator: a limestone slab, parameterized by
      width/height/depth (all limestone voxels, `VoxelTypes.LIMESTONE`).
      Player should spawn above the slab, not inside/under it.
  - [ ] Give it its own skybox color, not the default blue -- distinguish
        "you're in a different world" at a glance.
- [ ] **Checked -- not in the codebase, confirmed by grep across
      `scripts/`:** the poisson-disc-sampling-in-a-capsule +
      voxel-weighting idea for nice biome boundaries. Purely a future
      idea right now, no implementation to build on. Logged here so it
      doesn't get lost, not attempting it this pass.
- [ ] Panini removal: `panini_full.gdshader` / `panini_sky.gdshader` and
      the panini distortion baked into `xray_if_behind_full.gdshader`
      (the shared material every single block + the player's own shader
      use -- `shader_dirt.tres`, `shader_grass.tres`, etc. all reference
      it) get removed. This is *separate* from the cutout/x-ray-behind-
      terrain effect in that same shader, which must survive --
      that's explicitly called out as critical, not part of what's being
      removed. Removing panini distortion is also what makes real
      skyboxes (as opposed to whatever panini did to sky rendering)
      possible -- ties directly into the limestone slab's distinct sky
      and the depth-based switch below.
- [ ] Main world was supposed to have a Terraria-like depth-based skybox
      switch (different sky when underground vs. on the surface) -- not
      built yet, logged as follow-up once plain skyboxes exist at all.

## Phase 2 -- New voxels, both as mods (Phase 0 dependency)

- [ ] Wooden plank: `res://mods/wood_plank/`. Code-generated texture
      (`Image`/pixel-level, not hand-drawn) resembling the *inner rings*
      pattern of the existing log texture, not a plank-grain look --
      matching what was asked, even though "plank" more typically implies
      flat straight grain.
- [ ] Glass: `res://mods/glass/`. Fully transparent except the edges,
      which are white-blue and mostly (not fully) transparent. When two
      glass voxels sit next to each other, the shared face between them
      should disappear so a cluster of glass blocks reads as one
      continuous pane rather than a grid of visibly bordered cubes --
      this needs per-face visibility that depends on the *neighbor's*
      voxel type, which `VoxelMesherBlocky`'s side-culling may or may not
      expose the hooks for; needs research before implementation, not
      assumed solvable the same way as a normal opaque/cutout block.
