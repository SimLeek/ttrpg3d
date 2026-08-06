shader_type sky;

// No panini here (that's the point) -- straight cubemap lookup via the
// built-in EYEDIR, which is what makes samplerCube the natural fit over
// panini_sky.gdshader's 2D-panorama-plus-spherical-UV approach.
uniform samplerCube sky_cubemap : source_color, filter_linear;
uniform vec4 sky_tint : source_color = vec4(1.0);
uniform float exposure : hint_range(0.0, 10.0, 0.01) = 1.0;

void sky() {
	vec4 tex = texture(sky_cubemap, EYEDIR);
	COLOR = tex.rgb * sky_tint.rgb * exposure;
}
