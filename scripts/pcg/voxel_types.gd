extends Resource
class_name VoxelTypes

# Voxel types
# Invisible blocks
const AIR: int = 0
const DIRT: int = 1
# Gases that disperse over time
const CARBON_DIOXIDE: int = 2  # Low-lying pockets in Lava Tubes or deep Basalt basins. makes a warning sound and quickly kills player. Slowly turns into air when ticked and bordering normal air, though sometimes air can turn into it.
const RADON_GAS: int = 3  # spawns when a player sometimes breaks granite or gneiss. Makes geiger counter sounds when player is inside, and applies radiation effect.
const METHANE_GAS: int = 4  # pockets around coal/limestone caves. not breathable. Makes fog horn sound effect and damages. torches explode it.
const HELIUM_GAS: int = 5  # pockets inside floating islands. balloon whistle sound effect. Continuous balloon effects for a minute. Immediate death at the end of that minute. lifts into pools

const GRASS: int = 6
const WATER_FULL: int = 7
const WATER_TOP: int = 8
# VoxelBlockyModelFluid version of water, for flowing and height.
#const WATER_FULL = 13
#const WATER_TOP = 13
const LOG: int = 9
const LEAVES: int = 10
const TALL_GRASS: int = 11
const DEAD_SHRUB: int = 12

## Voxel types the player should walk straight through -- still hittable by
## VoxelTool.raycast() for targeting/interaction (voxel_library.tres keeps
## collision_aabbs set on these so items can still be placed/aimed against
## them), but not solid for player movement. A long pre-existing bug:
## voxel_library.tres already configures tall grass/dead shrub as non-
## collidable (collision_enabled_0 = false, same as water), which correctly
## keeps Godot's own physics/move_and_slide() from colliding with them --
## but player_blob_ctrl.gd's _handle_voxel_collisions() implements a SECOND,
## separate collision system on top of VoxelTool.raycast() (needed because
## voxel terrain collision shapes aren't always reliably queryable through
## normal physics -- see hud.gd's range-check doc comment for the same
## reliability reasoning), and that raycast hits ANYTHING with
## collision_aabbs regardless of collision_enabled_0 -- so tall grass and
## dead shrub were still acting as solid walls in practice, contradicting
## how they're actually configured. Water was fine already: it has no
## collision_aabbs at all, so this second raycast-based system never hit it
## either.
const NON_COLLIDABLE: Array[int] = [AIR, WATER_FULL, WATER_TOP, TALL_GRASS, DEAD_SHRUB]

static func is_player_collidable(voxel_id: int) -> bool:
	return voxel_id not in NON_COLLIDABLE

# Wall jump mountains - hard mode platforming
# (higher in ores at top, harder to get to, wall height higher than max jump height of 3)

# Host rocks
# Occur: Base of range.
const MUDSTONE: int = 16
# Occur: Base of range.
const LIMESTONE: int = 15
# Occur: Base mass.
const GRANITE: int = 14  
# Occur: High pressure zones.
const GNEISS: int = 29
# Occur: Middle elevations. PCG: High chance to hide Silver/Lead.
const SCHIST: int = 30
# Occur: Near Quartz veins. PCG: Very high blast resistance.
const QUARTZITE: int = 31
# Occur: Large pockets. PCG: Primary host for Lapis Lazuli.
const MARBLE: int = 32
# Occur: Volcanic slopes. PCG: Standard wall-jump surface.
const ANDESITE: int = 33
# Occur: High silica flows. PCG: Found near peak volcanic vents.
const RHYOLITE: int = 34
# Occur: Rapid cool zones.
const OBSIDIAN: int = 35
# Occur: Lava tube exteriors. PCG: Contains vertical columnar joints.
const BASALT: int = 36

const PLASTIGLOMERATE: int = 17  # can be partially melted to make other rocks more stable
const GYPSUM_ORE: int = 19
const HALITE_ORE: int = 20

# Ores & hazards
# Base altitude ores (Mid-Mountain)
# Occur: Common, widespread in large clusters. Appear: Green/Turquoise streaks.
# PCG: Use as "pathfinders" to guide players toward the vertical sections.
const COPPER_ORE: int = 21  # green

# High altitude tectonic ores
# Occur: Moderate. Appear: Metallic gray/blue cubes or dull sheen.
# PCG: Place inside vertical "splits" to reward wall-jumping progress.
const SILVER_ORE: int = 39
const LEAD_ORE: int = 40  # Galena
const ZINC_ORE: int = 41  # Sphalerite

# Hydrothermal vein system
# Occur: Uncommon.
const GOLD_ORE: int = 42
const QUARTZ: int = 22

# Rare summit ore
# Occur: Very Rare. Appear: Shiny white/silver-gray.
# PCG: Small clusters (1-2 blocks) at the highest accessible y-levels.
const PLATINUM_ORE: int = 44

# Peak specials
# Occur: Rare. Appear: Grey/Normal (Moly) vs Brilliant Red (Mercury/Cinnabar).
# PCG: Mercury should be near volcanic vents; Molybdenum near "plugs."
const MOLYBDENUM_ORE: int = 45 # top. looks normal
const MERCURY_ORE: int = 46 # cinnebar. Bright red.

# Extreme altitude only
# Occur: Unique/Exotic. Appear: Deep Blue (Lapis) vs Silver needles (Antimony).
# PCG: Lapis generates in Marble/Limestone hosts; Antimony in jagged clusters.
const LAPIS_ORE: int = 47  # peak only
const ANTIMONY_ORE: int = 48  # dangerous but valuable needles near the peak

# Volcanic vent gases
# Occur: Clusters near vents. Appear: Bright pale yellow crusts.
# PCG: Found in areas with high "heat" metadata or near lava tube entrances.
const SULFUR_ORE: int = 49

# Hazards
# Occur: Uncommon. Appear: Metallic white (Arseno) vs Brittle grey plates (Shale).
# PCG: Arseno deals poison/contact dmg; Shale acts as "falling block" trap.
const ARSENOPYRITE_ORE: int = 50  # damages player when touched
const LOOSE_SHALE: int = 51  # breaks and drops when touched

# Decorative flora
const ROCK_MOSS: int = 52
const ROCK_LICHEN: int = 53
# goats

# Platform mountains - platforming
const COAL_ORE: int = 18
const URANIUM_ORE: int = 55
const PLUTONIUM_ORE: int = 56

# Sky biome (Aerogel logic - extremely low density, semi-transparent)
# Occur: Floating "islands." Appear: Cloudy, semi-translucent blue. PCG: Zero fall damage when landing on.
const SKY_STONE: int = 57
# Occur: Top layer of islands. Appear: Pale blue/white dust. PCG: Players "sink" slightly when walking.
const SKY_DIRT: int = 58
# Occur: Surface vegetation. Appear: Neon cyan glowing filaments. PCG: Provides low-level ambient light.
const SKY_GRASS: int = 59
# Occur: Shady under-hangs. Appear: Pitch black bulbous growths. PCG: High carbon yield for crafting.
const COAL_FUNGUS: int = 60
# Occur: Near Radio Fungus. Appear: Glowing orange spores. PCG: Deals "radiation" DoT if player lingers.
const RADIO_FUNGUS: int = 70  
# Occur: Growing "up" from sky stone. Appear: Sharp, clear glass spikes. PCG: Hazards for wall-jumpers.
const QUARTZ_STALAGMITE: int = 71  
# Occur: Fragile sky-structures. Appear: Dark, brittle carbon spikes. PCG: Breaks after 2 seconds of standing.
const SHALE_STALAGMITE: int = 72  

# Lava tube caves (Navigation/Maze logic)
# Occur: Inside Basalt/Andesite. Appear: Metallic black. PCG: Disorients player HUD/Compass.
const MAGNETITE: int = 23  
# Occur: Tube cracks. Appear: Fluffy white "wool." PCG: Breath hazard; slows stamina regen if mined.
const ASBESTOS: int = 74
# Occur: Deep tube pockets. Appear: Translucent lime green. PCG: High value; found in "pockets" in walls.
const PERIDOT: int = 75
# Occur: High-temp walls. Appear: Deep dark red geometric gems. PCG: Very hard; requires high-tier tools.
const GARNET: int = 76
# Occur: Floor/Walls of tubes. Appear: Wet, oily black sheen. PCG: Player slides; cannot wall-jump effectively.
#const GLASS_COVER = 77
# Occur: Structural tunnels. Appear: Smooth, hollow cylinder. PCG: Forces "crawl" state; metadata < 1m.
#const CLASS_TUBE = 78  

const MOORE_DIRECTIONS: Array[Vector3i] = [
	Vector3i(-1, 0, -1),
	Vector3i(0, 0, -1),
	Vector3i(1, 0, -1),
	Vector3i(-1, 0, 0),
	Vector3i(1, 0, 0),
	Vector3i(-1, 0, 1),
	Vector3i(0, 0, 1),
	Vector3i(1, 0, 1)
]
