import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom, not "node" -- unlike server/shared, this package's pure-logic
    // tests often touch real DOM (hotbar/lobby-style UI pieces build and
    // query elements directly, no framework) rather than being pure
    // computation. noa-engine/Babylon.js themselves (real WebGL/3D) are
    // still out of scope for automated tests either way -- that's real
    // playtesting, per this project's established testing split.
    environment: "jsdom",
  },
});
