// Phase 2: noa-engine already implements floating-origin re-anchoring
// itself (checked its source directly -- `checkWorldOffset()` in its main
// tick loop rebases `noa.worldOriginOffset` and every dependent system once
// the player strays `originRebaseDistance` local units from origin), unlike
// the old repo's center_of_universe.gd which had to hand-roll this (plus a
// SoftBody3D mesh-reassignment workaround this port doesn't need, since
// custom soft-body physics is being dropped in favor of a real library --
// see docs/PORTING_CHECKLIST.md). So there's no re-anchoring logic to port
// here, just the always-available verification the project owner asked
// for: log every shift to the browser devtools console (Ctrl+Shift+I /
// F12), pairing with the fixed marker pillars in the test area (see
// world/testArea.ts) as the visual half of the same check.

import type { Engine } from "noa-engine";

export function installOriginShiftLogger(noa: Engine): void {
  let last: [number, number, number] = [...noa.worldOriginOffset] as [number, number, number];

  noa.on("tick", () => {
    const current = noa.worldOriginOffset;
    if (current[0] === last[0] && current[1] === last[1] && current[2] === last[2]) return;
    console.log(
      `[origin-shift] ${JSON.stringify(last)} -> ${JSON.stringify(current)} (delta: [${current[0] - last[0]}, ${current[1] - last[1]}, ${current[2] - last[2]}])`,
    );
    last = [current[0], current[1], current[2]];
  });
}
