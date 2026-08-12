extends BaseItem
class_name WingsItem

## Phase 8 movement item: having this anywhere in the hotbar (NOT equipped
## in a hand -- "you shouldn't have to put it in your main or off hand,
## that allows players to use spellbooks or other items while flying")
## lets F toggle flight -- disables gravity/normal jump for direct
## vertical control (hold jump to ascend, fly_descend/Shift to descend).
## player_blob_ctrl.gd checks player_inventory.gd's hotbar for a catalog
## entry with movement_mode == "flying" (item_catalog.gd's Wings entry
## mirrors this script's own defaults below), not a held item instance --
## this script's movement_mode/movement_speed only matter if the item
## also happens to be equipped for some other reason (still a normal
## BaseItem, nothing stops that), not for granting flight itself anymore.
##
## _ready(), not _init(): ItemCatalog.instantiate_item() builds a plain
## Node3D and attaches this script via set_script() afterward, which
## doesn't reliably invoke _init() the way MyScript.new() would --
## _ready() is the node-lifecycle hook that's guaranteed to run once this
## is actually in the tree, matching how BaseItem's own _ready() already
## finds item_hud the same way.

func _ready() -> void:
	super._ready()
	item_name = "Wings"
	movement_mode = "flying"
	movement_speed = 6.0
