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
// noa's own terrain-clip clamp is DISABLED by default, not used -- real
// bug found live: noa's `cameraObstructionDistance` (camera.js) sweeps
// backward by `max(zoomDistance, currentZoom)` every frame -- i.e. it
// always tests against the full TARGET zoom, not how much room is
// actually free nearby -- so once zoomed out in open space, walking into
// almost any tunnel narrower than MAX_ZOOM blocks snaps the camera back to
// first person, defeating the entire point of the xray-if-behind shader
// (blockShaders.ts): that shader exists SPECIFICALLY so geometry between
// the camera and player fades instead of blocking the view, making noa's
// hard collision-avoidance clamp redundant and actively harmful here
// (confirmed live: "blind... when going through tunnels underground").
// `updateAfterEntityRenderSystems` only does that one clamp (confirmed by
// reading it directly, a plain Camera.prototype method using only `this`,
// no outside closure) -- no-opping it on the instance (own-property
// shadows the prototype method) removes just the clamp, leaving the
// separate zoom-easing method (`updateBeforeEntityRenderSystems`)
// untouched; `delete`-ing that own-property override reveals the real
// prototype method again, restoring real collision.
//
// Real correction (2026-10-21): turning the GM-only panel's
// seeThroughWalls toggle OFF was only disabling blockShaders.ts's xray
// cutout fade -- "you only removed the cutout effect, not the ability
// for the camera to go through walls. The camera needs its
// spring/collision behavior toggled back on." The two clamps are
// independent (the shader fades geometry so a FAR camera doesn't get
// visually blocked; this clamp pulls the camera IN so it doesn't
// physically clip through terrain at all) -- seeThroughWalls OFF means
// "walls behave like walls" for both: no fade AND real collision.

import type { Engine } from "noa-engine";

export interface CameraZoomController {
  /** true (the default) = the camera can clip through/past thin terrain, matching the xray shader's fade so it isn't visually blocked either. false = noa's real collision clamp is restored, camera physically can't pass through walls. */
  setWallClipAllowed(allowed: boolean): void;
}

const MIN_ZOOM = 0;
// Real request (2026-10-17): extend the max zoom to 10x its old value (was
// 8), and default to the OLD max (8) instead of first person -- a
// character token's own billboard/bars are far more useful visible by
// default than not, and this also makes third person the default view
// (any zoomDistance above playerBodyMesh.ts's FIRST_PERSON_ZOOM_THRESHOLD
// already counts as third person, so defaulting non-zero here is the
// whole fix for that, not a separate setting).
const MAX_ZOOM = 80;
const DEFAULT_ZOOM = 8;
const ZOOM_STEP = 0.5;

export function installCameraZoom(noa: Engine): CameraZoomController {
  noa.camera.updateAfterEntityRenderSystems = () => {};
  noa.camera.zoomDistance = DEFAULT_ZOOM;

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

  return {
    setWallClipAllowed(allowed: boolean): void {
      if (allowed) {
        noa.camera.updateAfterEntityRenderSystems = () => {};
      } else {
        // Removes the own-property override above, revealing the real
        // Camera.prototype method again -- see this file's header for
        // why that's safe (plain method, only uses `this`).
        delete (noa.camera as { updateAfterEntityRenderSystems?: () => void }).updateAfterEntityRenderSystems;
      }
    },
  };
}
