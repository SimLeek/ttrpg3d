import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // @colyseus/testing's boot() always binds the same fixed port (2568)
    // when given a live Server instance -- it ignores any port argument in
    // that case (checked its source directly). Vitest's default per-file
    // parallelism means two test files that each boot() the real server
    // singleton race for that port; run files serially instead of trying to
    // work around the library's hardcoded port.
    fileParallelism: false,
  },
});
