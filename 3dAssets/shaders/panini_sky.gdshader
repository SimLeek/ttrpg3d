shader_type sky;

uniform sampler2D sky_texture : source_color, filter_linear_mipmap;
uniform vec4 sky_tint : source_color = vec4(1.0);
uniform float exposure : hint_range(0.0, 10.0, 0.01) = 1.0;

void sky() {
    vec3 dir = EYEDIR;

    // Standard equirectangular panorama sampling.
    float phi = atan(dir.x, -dir.z);
    float theta = asin(clamp(dir.y, -1.0, 1.0));
    vec2 sky_uv = vec2(phi / (2.0 * PI) + 0.5, 0.5 - theta / PI);

    vec4 tex = texture(sky_texture, sky_uv);
    COLOR = tex.rgb * sky_tint.rgb * exposure;
}