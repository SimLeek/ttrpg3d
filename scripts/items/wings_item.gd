extends BaseItem
class_name WingsItem

## Phase 8 movement item: grants flight for as long as it's equipped in
## either hand -- disables gravity/normal jump for direct vertical control
## (hold jump to ascend, fly_descend/Shift to descend), same behavior the
## old built-in double-tap-jump gesture used to grant, just driven by
## equipping this item now instead of a key toggle. Passive/worn, not
## click-activated -- no use_item() override needed, player_blob_ctrl.gd
## reads movement_mode/movement_speed directly off whichever hand holds it.
##
## _ready(), not _init(): ItemCatalog.instantiate_item() builds a plain
## Node3D and attaches this script via set_script() afterward, which
## doesn't reliably invoke _init() the way MyScript.new() would --
## _ready() is the node-lifecycle hook that's guaranteed to run once this
## is actually in the tree (on equip), matching how BaseItem's own
## _ready() already finds item_hud the same way.

func _ready() -> void:
	super._ready()
	item_name = "Wings"
	movement_mode = "flying"
	movement_speed = 6.0
