extends Node3D
class_name BaseItem

## Base class for all holdable items in the game
## Items should inherit from this and override use_item() with their specific behavior

signal item_used(pressure: float)

@export var item_name: String = "Base Item"
@export var can_use: bool = true

## Shown via the ItemTooltip billboard (scripts/ui/item_tooltip.gd) when this
## item is equipped, if non-empty. Subclasses with non-obvious controls (e.g.
## structure save/place's P/G/R keys) should set this in set_character().
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
	if tooltip_text != "" and character:
		var tooltip = character.get_tree().get_first_node_in_group("item_tooltip")
		if tooltip:
			tooltip.show_message(tooltip_text, tooltip_icon)

## Optional: Override for custom unequip behavior
func on_unequipped() -> void:
	visible = false
	if item_hud:
		item_hud.visible = false
