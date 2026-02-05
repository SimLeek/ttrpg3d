shader_type spatial;
render_mode blend_mix, depth_prepass_alpha, cull_disabled;

global uniform vec3 player_position;
global uniform vec3 camera_position;

uniform float sat_min : hint_range(0.0, 1.0) = 0.35;
uniform float sat_max : hint_range(0.0, 1.0) = 1.0;
uniform float val_min : hint_range(0.0, 1.0) = 0.8;
uniform float val_max : hint_range(0.0, 1.0) = 1.0;
uniform float alpha_min : hint_range(0.1, 1.0, 0.1) = 0.2;
uniform float alpha_max : hint_range(0.1, 1.0, 0.1) = 1.0;

uniform float cutout_radius : hint_range(0.1, 10.0, 0.05) = 5;
uniform float cutout_pow : hint_range(0.1, 10.0, 0.05) = 10;
uniform float below_pow : hint_range(0.1, 10.0, 0.05) = 0.2;
uniform float forward_pow : hint_range(0.01, 100.0, 0.05) = 0.05;
uniform float cone_extra : hint_range(0.01, 100.0, 0.05) = 1;
uniform float floor_fade_start : hint_range(-2.0, 2.0, 0.01) = 0.0;
uniform float floor_fade_length : hint_range(0.1, 5.0, 0.1) = 0.25;
uniform float camera_min_dist : hint_range(0.1, 10.0, 0.1) = 0.5;

uniform sampler2D albedo_texture : source_color, filter_linear_mipmap, repeat_enable;
uniform vec4 albedo_color : source_color = vec4(1.0);

uniform sampler2D normal_texture : hint_normal, filter_linear_mipmap, repeat_enable;
uniform float normal_scale : hint_range(-16, 16) = 1.0;

uniform sampler2D roughness_texture : hint_roughness_g, filter_linear_mipmap, repeat_enable;
uniform float roughness : hint_range(0, 1) = 0.8;

uniform sampler2D metallic_texture : hint_default_black, filter_linear_mipmap, repeat_enable;
uniform float metallic : hint_range(0, 1) = 0.0;

uniform sampler2D rim_texture : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float rim : hint_range(0, 1) = 0.0;
uniform float rim_tint : hint_range(0, 1) = 0.5;

uniform sampler2D emission_texture : hint_default_black, filter_linear_mipmap, repeat_enable;
uniform vec3 emission : source_color = vec3(0.0);
uniform float emission_energy_multiplier : hint_range(0.0, 16.0) = 1.0;

varying vec3 frag_world_pos;

// Helper: Convert RGB to HSV
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// Helper: Convert HSV back to RGB
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void vertex() {
    frag_world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
    vec4 albedo_tex = texture(albedo_texture, UV);
    vec3 raw_rgb = albedo_tex.rgb * albedo_color.rgb;

	vec3 hsv = rgb2hsv(raw_rgb);
    hsv.y = clamp(hsv.y, sat_min, sat_max); // Clamp Saturation
    hsv.z = clamp(hsv.z, val_min, val_max); // Clamp Value (Brightness)

    ALBEDO = hsv2rgb(hsv);

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

	vec3 full_dir = camera_position - player_position;
    vec3 dir = normalize(full_dir);
    float line_length = length(camera_position - player_position);

    float t = dot(frag_world_pos - player_position, dir);

    ALPHA = albedo_tex.a * albedo_color.a;
    vec3 closest = player_position + t * dir;
    float perp_dist = length(frag_world_pos - closest);
	float del_extra = 0.0;

	float cone_mult = cutout_radius*t/line_length+cone_extra;
	if(line_length>camera_min_dist){
	   if (perp_dist < cone_mult) {
	    	ALPHA *= abs(pow((perp_dist-cone_mult)/cone_mult + pow(del_extra,below_pow) +1.0,cutout_pow));
	    }
	if(t<0.0){
		ALPHA-=t/(cutout_radius*forward_pow);
	}

	float y_dist = frag_world_pos.y - (player_position.y - floor_fade_start);

	float vertical_mask = 0.0;

	if (camera_position.y > player_position.y) {
	    vertical_mask = clamp( -(y_dist / floor_fade_length), 0.0, 1.0);
	}
	ALPHA += vertical_mask;

	ALPHA = min(max(ALPHA, alpha_min), alpha_max);
	}
}