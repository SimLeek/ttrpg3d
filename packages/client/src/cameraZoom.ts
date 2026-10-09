// Third-person zoom -- a prerequisite for the xray-if-behind shader to
// mean anything (in pure first person the camera sits at the player's
// eye, so the "cone from player toward camera" the shader fades along is
// nearly degenerate). Direct behavioral port of the old game's
// scripts/spring_arm_3d_look.gd: Ctrl+scroll-wheel zooms (plain scroll is
// reserved for hotbar.ts's slot cycling, same split that file's own
// comment already independently arrived at), clamped to the old game's
// own 0..8 range. Smoothing (`camera.currentZoom` easing toward
// `camera.zoomDistance` each tick) is still noa's own built-in behavior.
//
// noa's own terrain-clip clamp is deliberately DISABLED below, not used --
// real bug found live: noa's `cameraObstructionDistance` (camera.js)
// sweeps backward by `max(zoomDistance, currentZoom)` every frame -- i.e.
// it always tests against the full TARGET zoom, not how much room is
// actually free nearby -- so once zoomed out in open space, walking into
// almost any tunnel narrower than MAX_ZOOM blocks snaps the camera back to
// first person, defeating the entire point of the xray-if-behind shader
// (blockShaders.ts): that shader exists SPECIFICALLY so geometry between
// the camera and player fades instead of blocking the view, making noa's
// hard collision-avoidance clamp redundant and actively harmful here
// (confirmed live: "blind... when going through tunnels underground").
// `updateAfterEntityRenderSystems` only does that one clamp (confirmed by
// reading it directly) -- no-opping it on the instance (own-property
// shadows the prototype method) removes just the clamp, leaving the
// separate zoom-easing method (`updateBeforeEntityRenderSystems`)
// untouched.

import type { Engine } from "noa-engine";

const MIN_ZOOM = 0;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.5;

export function installCameraZoom(noa: Engine): void {
  noa.camera.updateAfterEntityRenderSystems = () => {};

  window.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault(); // Ctrl+wheel is browser page-zoom by default -- deliberate override, needs a non-passive listener to actually take effect
      const next = noa.camera.zoomDistance + (event.deltaY > 0 ? ZOOM_STEP : -ZOOM_STEP);
      noa.camera.zoomDistance = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    },
    { passive: false },
  );
}
