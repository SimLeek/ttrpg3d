extends RefCounted
class_name ProceduralSkybox

## Generates a seamless procedural cubemap sky -- "seamless" here means
## every pair of adjacent faces' shared-edge pixels match exactly, so
## there's no visible seam at the cube's corners.
##
## The trick that makes this automatic instead of something to hand-tune:
## color is a function of the *continuous 3D direction* a texel represents
## on the cube (dir_to_color()), not of each face's local 2D UV in
## isolation. Two texels on adjacent faces that sit on the shared edge
## point in the same 3D direction, so they necessarily get the same color
## -- seamlessness falls out of the math rather than needing explicit
## per-edge matching logic.

## Face order matches Godot's expected cubemap layer order: +X, -X, +Y,
## -Y, +Z, -Z (right, left, top, bottom, front, back).
static func generate_cubemap(size: int, base_color: Color, hi_color: Color) -> Cubemap:
	var images: Array[Image] = []
	for face in range(6):
		images.append(_generate_face(face, size, base_color, hi_color))
	var cubemap := Cubemap.new()
	cubemap.create_from_images(images)
	return cubemap

static func _generate_face(face: int, size: int, base_color: Color, hi_color: Color) -> Image:
	var img := Image.create(size, size, false, Image.FORMAT_RGB8)
	for py in range(size):
		for px in range(size):
			# UV in [-1, 1], texel-centered.
			var u := (float(px) + 0.5) / size * 2.0 - 1.0
			var v := (float(py) + 0.5) / size * 2.0 - 1.0
			var dir := _face_uv_to_direction(face, u, v)
			img.set_pixel(px, py, _dir_to_color(dir, base_color, hi_color))
	return img

static func _face_uv_to_direction(face: int, u: float, v: float) -> Vector3:
	var dir: Vector3
	match face:
		0: dir = Vector3(1.0, -v, -u)   # +X
		1: dir = Vector3(-1.0, -v, u)   # -X
		2: dir = Vector3(u, 1.0, v)     # +Y
		3: dir = Vector3(u, -1.0, -v)   # -Y
		4: dir = Vector3(u, -v, 1.0)    # +Z
		_: dir = Vector3(-u, -v, -1.0)  # -Z
	return dir.normalized()

## Smooth (continuous, no discontinuities) function of direction only --
## banded rings around a couple of axes plus a bit of multi-frequency
## variation, purple-toned. Being a pure function of `dir` is what
## guarantees the cube-edge seamlessness above.
static func _dir_to_color(dir: Vector3, base_color: Color, hi_color: Color) -> Color:
	var band := sin(dir.x * 6.0) * sin(dir.y * 6.0) * sin(dir.z * 6.0)
	var swirl := sin((dir.x + dir.y) * 3.0) * cos((dir.y - dir.z) * 3.0)
	var t: float = clamp((band * 0.6 + swirl * 0.4 + 1.0) * 0.5, 0.0, 1.0)
	return base_color.lerp(hi_color, t)
