shader_type spatial;
// Same as xray_if_behind_cutout.gdshader, except cull_back instead of
// cull_disabled -- needed specifically for light-emitting blocks. With
// cull_disabled, a shadow-casting light positioned at a solid cube's own
// center (LightRegistry.gd puts real-mode OmniLight3D there) sees that
// SAME cube's own inward-facing geometry as an occluder in every
// direction (cull_disabled renders both winding directions, so the
// cube's outward-normal faces also render/shadow-cast when viewed from
// inside, i.e. from the light's own position) -- the light ends up
// trapped inside its own mesh, blocked by nothing else, confirmed live.
// Normal single-sided culling means those same faces are invisible (and
// don't cast shadow) from the inside, since backface culling drops them
// when viewed from behind their outward normal -- exactly the light's
// own vantage point. Every other block keeps cull_disabled (needed for
// the xray-behind-player effect not to show one-sided holes) since
// nothing else has a light positioned inside its own geometry.
render_mode blend_mix, depth_prepass_alpha, cull_back;

global uniform vec3 player_position;
global uniform vec3 camera_position;

uniform float cutout_radius : hint_range(0.1, 10.0, 0.05) = 5.0;
uniform float cutout_pow : hint_range(0.1, 10.0, 0.05) = 10.0;
uniform float forward_pow : hint_range(0.01, 100.0, 0.05) = 0.05;
uniform float cone_extra : hint_range(0.01, 100.0, 0.05) = 1.0;
uniform float floor_fade_start : hint_range(-2.0, 2.0, 0.01) = 0.0;
uniform float floor_fade_length : hint_range(0.1, 5.0, 0.1) = 0.25;
uniform float alpha_min : hint_range(0.0, 1.0, 0.01) = 0.0;
uniform float camera_min_dist : hint_range(0.1, 10.0, 0.1) = 0.5;

uniform sampler2D albedo_texture : source_color, filter_nearest_mipmap, repeat_enable;
uniform vec4 albedo_color : source_color = vec4(1.0);

uniform sampler2D normal_texture : hint_normal, filter_nearest_mipmap, repeat_enable;
uniform float normal_scale : hint_range(-16.0, 16.0) = 1.0;

uniform sampler2D roughness_texture : hint_roughness_g, filter_nearest_mipmap, repeat_enable;
uniform float roughness : hint_range(0.0, 1.0) = 1.0;

uniform sampler2D metallic_texture : hint_default_black, filter_nearest_mipmap, repeat_enable;
uniform float metallic : hint_range(0.0, 1.0) = 0.0;

uniform sampler2D rim_texture : hint_default_white, filter_nearest_mipmap, repeat_enable;
uniform float rim : hint_range(0.0, 1.0) = 0.0;
uniform float rim_tint : hint_range(0.0, 1.0) = 0.5;

uniform sampler2D emission_texture : hint_default_black, filter_nearest_mipmap, repeat_enable;
uniform vec3 emission : source_color = vec3(0.0);
uniform float emission_energy_multiplier : hint_range(0.0, 16.0) = 1.0;

varying vec3 frag_world_pos;

void vertex() {
	frag_world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec4 albedo_tex = texture(albedo_texture, UV);
	ALBEDO = albedo_tex.rgb * albedo_color.rgb;

	float metallic_tex = texture(metallic_texture, UV).r;
	METALLIC = metallic_tex * metallic;

	float roughness_tex = texture(roughness_texture, UV).g;
	ROUGHNESS = roughness_tex * roughness;

	vec3 normal_tex = texture(normal_texture, UV).rgb;
	NORMAL_MAP = normal_tex;
	NORMAL_MAP_DEPTH = normal_scale;

	vec3 emission_tex = texture(emission_texture, UV).rgb;
	EMISSION = emission_tex * emission * emission_energy_multiplier;

	float rim_tex = texture(rim_texture, UV).r;
	RIM = rim_tex * rim;
	RIM_TINT = rim_tint;

	float original_alpha = albedo_tex.a * albedo_color.a;
	ALPHA = original_alpha;

	if (original_alpha > 0.001) {
		vec3 cam_to_player = camera_position - player_position;
		float line_length = length(cam_to_player);

		if (line_length > camera_min_dist) {
			vec3 dir = normalize(cam_to_player);
			float t = dot(frag_world_pos - player_position, dir);

			vec3 closest = player_position + t * dir;
			float perp_dist = length(frag_world_pos - closest);

			float cone_radius = cutout_radius * (t / line_length) + cone_extra;

			float cutout = 1.0;

			if (perp_dist < cone_radius) {
				float normalized = perp_dist / cone_radius;
				cutout = pow(normalized, cutout_pow);
			}

			float y_dist = frag_world_pos.y - (player_position.y - floor_fade_start);
			float vertical_mask = 0.0;
			if (camera_position.y > player_position.y) {
				vertical_mask = clamp(-y_dist / floor_fade_length, 0.0, 1.0);
			}

			ALPHA = original_alpha * cutout;
			if (t < 0.0) {
				ALPHA -= t / (cutout_radius * forward_pow);
			}
			ALPHA = mix(ALPHA, original_alpha, vertical_mask);
			ALPHA = clamp(ALPHA, alpha_min * original_alpha, original_alpha);
		}
	}

	if (ALPHA < 0.999) {
		discard;
	}
}
