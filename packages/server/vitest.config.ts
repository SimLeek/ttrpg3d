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
    // Real bug found live (not flakiness to tolerate, a genuine
    // under-budget default): these tests are real @colyseus/testing
    // room connections -- actual async handshakes over a real
    // WebSocket/HTTP server, not mocked. Vitest's global default
    // testTimeout (5000ms) is tight enough that a busy dev machine
    // (confirmed directly via `uptime`/`ps` -- load average over 2x
    // this machine's core count, from unrelated foreground apps) can
    // push a single handshake past it even though nothing is actually
    // hung, reproduced via a clean `git stash` baseline run showing
    // the exact same timeout failures with zero code changes. Raised
    // generously (not "just big enough to pass once") since the
    // failure mode here is a real op running out of wall-clock time
    // under load, not a hang to paper over.
    testTimeout: 20000,
  },
});
