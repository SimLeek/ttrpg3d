shader_type spatial;
render_mode blend_mix, depth_draw_always, cull_back;

// --- STANDARD PBR UNIFORMS ---
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform sampler2D albedo_texture : source_color, filter_nearest_mipmap, repeat_enable;

uniform sampler2D normal_texture : hint_normal, filter_nearest_mipmap, repeat_enable;
uniform float normal_scale : hint_range(-16, 16) = 1.0;

uniform sampler2D roughness_texture : hint_roughness_g, filter_nearest_mipmap, repeat_enable;
uniform float roughness : hint_range(0, 1) = 1.0;

uniform sampler2D metallic_texture : hint_default_black, filter_nearest_mipmap, repeat_enable;
uniform float metallic : hint_range(0, 1) = 0.0;

uniform sampler2D rim_texture : hint_default_white, filter_nearest_mipmap, repeat_enable;
uniform float rim : hint_range(0, 1) = 0.0;
uniform float rim_tint : hint_range(0, 1) = 0.5;

uniform sampler2D emission_texture : hint_default_black, filter_nearest_mipmap, repeat_enable;
uniform vec3 emission : source_color = vec3(0.0);
uniform float emission_energy_multiplier : hint_range(0.0, 16.0) = 1.0;

void fragment() {
    // --- Albedo ---
    vec4 albedo_tex = texture(albedo_texture, UV);
    ALBEDO = albedo_tex.rgb * albedo_color.rgb;

    // --- Normal Map ---
    vec3 normal_tex = texture(normal_texture, UV).rgb;
    NORMAL_MAP = normal_tex;
    NORMAL_MAP_DEPTH = normal_scale;

    // --- Roughness & Metallic ---
    ROUGHNESS = texture(roughness_texture, UV).g * roughness;
    METALLIC = texture(metallic_texture, UV).r * metallic;

    // --- Emission ---
    vec3 emission_tex = texture(emission_texture, UV).rgb;
    EMISSION = emission_tex * emission * emission_energy_multiplier;

    // --- Rim Lighting ---
    RIM = texture(rim_texture, UV).r * rim;
    RIM_TINT = rim_tint;
}