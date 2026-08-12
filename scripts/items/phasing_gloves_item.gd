extends BaseItem
class_name PhasingGlovesItem

## Phase 8 movement item: grants intangibility for as long as it's
## equipped in either hand -- disables collision entirely so you can pass
## through terrain, same as the old built-in double-tap-Shift gesture used
## to grant, just driven by equipping this item now instead of a key
## toggle. Also uses the same direct vertical control WingsItem's flying
## does (player_blob_ctrl.gd treats flying/intangible as the same
## no-gravity control path) -- intangible alone would otherwise free-fall
## through everything with no way to stop. Passive/worn, not
## click-activated. See wings_item.gd for why this uses _ready() rather
## than _init() to set its stats.

func _ready() -> void:
	super._ready()
	item_name = "Phasing Gloves"
	movement_mode = "intangible"
	movement_speed = 6.0
