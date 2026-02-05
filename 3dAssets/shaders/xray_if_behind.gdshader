shader_type spatial;
render_mode blend_mix, depth_draw_always, cull_back; //cull_disabled;

global uniform vec3 player_position;
global uniform vec3 camera_position;

uniform float cutout_radius : hint_range(0.1, 10.0, 0.05) = 1.5;
uniform float cutout_pow : hint_range(0.1, 10.0, 0.05) = 3;

/*uniform sampler2D albedo_texture : source_color, filter_linear_mipmap, repeat_enable;
uniform vec4 albedo_color : source_color = vec4(1.0);

uniform sampler2D normal_texture : hint_normal, filter_linear_mipmap, repeat_enable;
uniform float normal_scale : hint_range(-16, 16) = 1.0;

uniform sampler2D roughness_texture : hint_roughness_g, filter_linear_mipmap, repeat_enable;
uniform float roughness : hint_range(0, 1) = 1.0;

uniform sampler2D metallic_texture : hint_default_black, filter_linear_mipmap, repeat_enable;
uniform float metallic : hint_range(0, 1) = 0.0;

uniform sampler2D rim_texture : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float rim : hint_range(0, 1) = 0.0;
uniform float rim_tint : hint_range(0, 1) = 0.5;

uniform sampler2D emission_texture : hint_default_black, filter_linear_mipmap, repeat_enable;
uniform vec3 emission : source_color = vec3(0.0);
uniform float emission_energy_multiplier : hint_range(0.0, 16.0) = 1.0;*/

varying vec3 frag_world_pos;

void vertex() {
    frag_world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
    /*vec4 albedo_tex = texture(albedo_texture, UV);
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
    RIM_TINT = rim_tint;*/

    vec3 origin = player_position;
    vec3 dir = normalize(camera_position - player_position);
    float line_length = length(camera_position - player_position);

    float t = dot(frag_world_pos - origin, dir);

    //ALPHA = albedo_tex.a * albedo_color.a;
	//ALPHA = 1.0;
    if (t > 0.0 && t < line_length) {
        vec3 closest = origin + t * dir;
        float perp_dist = length(frag_world_pos - closest);
        if (perp_dist < cutout_radius) {
            ALPHA *= pow((perp_dist-cutout_radius)/cutout_radius+1.0,cutout_pow);
        }
    }
}