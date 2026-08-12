extends BaseItem
class_name PhasingGlovesItem

## Phase 8 movement item: having this anywhere in the hotbar (not equipped
## in a hand -- see wings_item.gd for why) lets double-tapping Ctrl toggle
## intangibility -- disables collision entirely so you can pass through
## terrain. Also uses the same direct vertical control WingsItem's flying
## does (player_blob_ctrl.gd treats flying/intangible as the same
## no-gravity control path) -- intangible alone would otherwise free-fall
## through everything with no way to stop. See wings_item.gd for why this
## uses _ready() rather than _init() to set its stats, and why
## movement_mode/movement_speed here don't matter for granting the mode
## itself anymore (item_catalog.gd's catalog entry is what's actually
## checked).

func _ready() -> void:
	super._ready()
	item_name = "Phasing Gloves"
	movement_mode = "intangible"
	movement_speed = 6.0
