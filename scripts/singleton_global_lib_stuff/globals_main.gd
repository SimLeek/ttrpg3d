extends RefCounted
class_name GlobalLib

static func special_ray_check(ray, body:CharacterBody3D, player, exclude=null, hit_from_inside=false):
	if ray:
		var query: PhysicsRayQueryParameters3D = PhysicsRayQueryParameters3D.create(ray.global_position, ray.global_position+ray.target_position)
		if exclude:
			query.exclude = exclude
		query.collide_with_areas = false
		query.collide_with_bodies = true
		query.hit_from_inside = hit_from_inside
		query.hit_back_faces = true
		var space_state = body.get_world_3d().direct_space_state
		var hit1: Dictionary = space_state.intersect_ray(query)
		if hit1.is_empty():
			return null
		else:
			var hit = hit1["collider"]
			if player.is_ancestor_of(hit) or hit == player:
				hit1["player"] = true
			else:
				hit1["player"] = false
			return hit1
