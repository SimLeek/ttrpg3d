shader_type spatial;
render_mode blend_mix, depth_draw_always, cull_disabled;

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

			// See xray_if_behind_cutout.gdshader for why this isn't just
			// "perp_dist < cone_radius" -- the t > 0.0 restriction here
			// was what flattened the cutout into a plain circle.
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

	// Only discard fully invisible pixels to save fill rate. Soft alpha is preserved.
	if (ALPHA < 0.001) {
		discard;
	}
}