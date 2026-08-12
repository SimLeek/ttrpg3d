extends Node3D
class_name BaseItem

## Base class for all holdable items in the game
## Items should inherit from this and override use_item() with their specific behavior

signal item_used(pressure: float)

@export var item_name: String = "Base Item"
@export var can_use: bool = true

## Phase 8: movement mode this item grants for as long as it's equipped in
## either hand -- "" (default) means none. player_blob_ctrl.gd checks both
## hands' held_item.movement_mode each physics frame rather than a
## built-in double-tap/key toggle (see WingsItem/PhasingGlovesItem for the
## two current values, "flying"/"intangible" -- any string works, this
## isn't a hardcoded enum, so mods can add new movement items too).
## movement_speed is that item's own vertical-control speed for the mode
## it grants (each movement item has its own stat rather than sharing one
## constant).
@export var movement_mode: String = ""
@export var movement_speed: float = 0.0

## Control hint (e.g. structure save/place's P/G/R keys), set by
## ItemCatalog.instantiate_item() from the catalog entry's "hint". Shown as
## a 2D hover tooltip in the inventory menu (scripts/ui/player_inventory.gd)
## -- not auto-shown on equip, since the item may be equipped while the
## inventory itself is open, and a 3D world-space billboard (ItemTooltip,
## scripts/ui/item_tooltip.gd) would render behind that 2D menu. ItemTooltip
## is still around for a future "aim at a thing in the world" use case, just
## not wired to equip.
var tooltip_text: String = ""
var tooltip_icon: Texture2D = null

var character: CharacterBody3D = null
## Reference to any HUD elements this item should show/hide
var item_hud: Control = null

func _ready() -> void:
	# Find any HUD child nodes and store reference
	for child in get_children():
		if child is Control:
			item_hud = child
			break

## Called when the item is used
## pressure: 0.0-1.0 value, where 1.0 is full press (click) and 0.0-0.99 is analog trigger
func use_item(pressure: float) -> void:
	if not can_use:
		return
	
	# Override this in child classes
	print("%s used with pressure: %.2f" % [item_name, pressure])
	item_used.emit(pressure)

## Set the character reference (called by HandController)
func set_character(chara: CharacterBody3D) -> void:
	character = chara

## Called when pause menu opens/closes
## visible_state: true = show item, false = hide item
func handle_pause(visible_state: bool) -> void:
	visible = visible_state
	if item_hud:
		item_hud.visible = visible_state

## Optional: Override for custom equip behavior
func on_equipped() -> void:
	visible = true
	if item_hud:
		item_hud.visible = true

## Optional: Override for custom unequip behavior
func on_unequipped() -> void:
	visible = false
	if item_hud:
		item_hud.visible = false
