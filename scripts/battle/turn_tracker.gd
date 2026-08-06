extends Node

## Autoload. DM-facing initiative/turn tracker -- a plain ordered list of
## combatant names plus a "whose turn is it" index and a round counter.
## In-memory only (not persisted -- combatants are per-encounter, unlike
## worlds/mods which are meant to survive a relaunch).

signal combatants_changed
signal turn_changed(current_index: int, round_number: int)

var combatants: Array[Dictionary] = []  # {name: String}
var current_index: int = -1
var round_number: int = 1

func add_combatant(combatant_name: String) -> void:
	if combatant_name.strip_edges().is_empty():
		return
	combatants.append({"name": combatant_name})
	if current_index == -1:
		current_index = 0
		turn_changed.emit(current_index, round_number)
	combatants_changed.emit()

func remove_combatant(index: int) -> void:
	if index < 0 or index >= combatants.size():
		return
	combatants.remove_at(index)
	if combatants.is_empty():
		current_index = -1
	elif current_index >= combatants.size():
		current_index = 0
	elif current_index > index:
		current_index -= 1
	combatants_changed.emit()
	turn_changed.emit(current_index, round_number)

func next_turn() -> void:
	if combatants.is_empty():
		return
	current_index += 1
	if current_index >= combatants.size():
		current_index = 0
		round_number += 1
	turn_changed.emit(current_index, round_number)

func clear() -> void:
	combatants.clear()
	current_index = -1
	round_number = 1
	combatants_changed.emit()
	turn_changed.emit(current_index, round_number)
