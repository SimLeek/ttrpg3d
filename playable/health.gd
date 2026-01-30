extends Node3D

signal health_changed(current_hp, max_hp)

@export_group("Fall Damage Settings")
@export var turn_on_fall_damage: bool = true
@export var k: float = 0.005          # Multiplier (Tuned for 1.0 Max HP)
@export var v_min: float = 15.0       # Threshold to start taking damage
@export var n: float = 2.0            # Exponential scaling

@export_group("Health Settings")
@export var max_health: float = 1.0
@export var total_recovery_seconds: float = 60.0

@onready var current_health: float = max_health
@onready var parent_body: CharacterBody3D = get_parent() as CharacterBody3D

var last_global_pos: Vector3
var current_velocity: float = 0
var last_velocity_y: float = 0.0
func _ready() -> void:
	last_global_pos = global_position

func _process(delta: float) -> void:
	# Recover (100/60)% of max HP per second
	if current_health < max_health:
		var recovery_rate = (max_health / total_recovery_seconds)
		current_health = move_toward(current_health, max_health, recovery_rate * delta)
		health_changed.emit(current_health, max_health)

func _physics_process(delta: float) -> void:
	if delta == 0.0:
		return
	if not parent_body or not turn_on_fall_damage:
			return
	# Calculate current velocity based on position change
	# restricted to vertical only, otherwise wall jumping causes damage
	var current_velocity_y = parent_body.velocity.y	
	if last_velocity_y < -v_min:
		# If we hit the ground, current_velocity_y will be 0 or slightly positive
		# dv represents the "jolt" magnitude
		# vf=vf+at -> a=(vf-vi)/t, but t is constant since this is phyics process
		# and this works, so we're keeping it
		var dv = (current_velocity_y - last_velocity_y)
		
		if dv > v_min:
			apply_damage(k * pow(dv - v_min, n))

	last_velocity_y = current_velocity_y

func apply_damage(amount: float) -> void:
	current_health -= amount
	current_health = maxf(0.0, current_health)
	health_changed.emit(current_health, max_health)
	
	if current_health <= 0:
		var parent = get_parent()
		if parent and parent.has_method("die"):
			parent.die()
