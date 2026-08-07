extends Node

## Autoload. Reference-counted get_tree().paused -- multiple UI elements
## (dm_world_menu.gd while open, turn_tracker_menu.gd's name field while
## focused, and any future ones) can each want the game paused at
## overlapping times. A single shared boolean would let one of them
## closing/losing focus incorrectly unpause while another still wants it.

var _reasons: Dictionary = {}  # arbitrary key -> true

func request(key: String) -> void:
	_reasons[key] = true
	get_tree().paused = true

func release(key: String) -> void:
	_reasons.erase(key)
	get_tree().paused = not _reasons.is_empty()

## Unconditionally drops every pause reason -- for leaving the scene
## entirely (world switch), where any menu that requested a pause is about
## to be freed anyway and would otherwise leave a stale reason behind
## forever (this autoload survives scene reloads, the menus don't).
func release_all() -> void:
	_reasons.clear()
	get_tree().paused = false
