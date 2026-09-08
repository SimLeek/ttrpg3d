// Phase 0: proves the workspace-linking setup works end to end -- both the
// client and server import this same type from the shared package. Real
// game data (voxel types, item catalog, network message shapes) lands here
// starting Phase 2, per the migration plan.

export interface HelloMessage {
  text: string;
  sentAt: number;
}
