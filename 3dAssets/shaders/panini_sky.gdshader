shader_type sky;

// --- GLOBAL UNIFORMS (Keep these synced with your game) ---
uniform float panini_d : hint_range(0.0, 1.0) = 0.5;
uniform float panini_s : hint_range(0.0, 1.0) = 0.0;
//global uniform float panini_enabled;
//global uniform mat4 camera_transform; // Add this as a 'Transform3D' in Project Settings

uniform sampler2D sky_texture : source_color, filter_linear_mipmap;
uniform vec4 sky_tint : source_color = vec4(1.0);
uniform float exposure : hint_range(0.0, 10.0, 0.01) = 1.0;

void sky() {
    // 1. Get the direction the camera is looking for this specific pixel
    vec3 dir = EYEDIR;

    /*if (panini_enabled > 0.5) {
        // 2. TRANSFORM TO VIEW SPACE
        // This is the "Lens" secret. We move the ray into camera-local space
        // so the distortion stays locked to your screen, not the north pole.
        // In Godot 4 sky shaders, INV_VIEW_MATRIX converts World -> View.
		mat4 view_mat = inverse(camera_transform);
        vec3 v_view = view_rot * dir;

        // 3. APPLY PANINI WARP (Only to what the camera sees)
        // We use the same math as your mesh shader
        float dist_xz = length(v_view.xz);
        float alpha = atan(v_view.x, -v_view.z);
        
        float d_plus_cos = max(panini_d + cos(alpha), 0.01);
        float S = (panini_d + 1.0) / d_plus_cos;
        
        v_view.x = S * sin(alpha) * dist_xz;
        v_view.z = -((S * cos(alpha) - panini_d) * dist_xz);
        v_view.x *= (1.0 - panini_s);
        
        // 4. TRANSFORM BACK TO WORLD SPACE
        // Now that we've "bent" the light through the lens, we see where 
        // it hits the actual sky.
        dir = (VIEW_MATRIX * vec4(v_view, 0.0)).xyz;
    }*/

    // 5. STANDARD PANORAMA SAMPLING
    // Now we just use our "bent" direction to pick a pixel from the sky texture
    float phi = atan(dir.x, -dir.z);
    float theta = asin(clamp(dir.y, -1.0, 1.0));
    vec2 sky_uv = vec2(phi / (2.0 * PI) + 0.5, 0.5 - theta / PI);

    vec4 tex = texture(sky_texture, sky_uv);
    COLOR = tex.rgb * sky_tint.rgb * exposure;
}