// Trivial fixture mod for modLoader.test.ts and a real playtest's manual
// verification -- deliberately NOT a voxel/generator-registering mod
// (MVP goal item 3's own plan explicitly keeps the voxel-id-widening
// blocker out of scope; see modLoader.ts's header). Just proves
// register()/unregister() actually get called, via an observable
// module-level flag and a console log a real playtester can see.

export let registered = false;

export function register(): void {
  registered = true;
  console.log("[mods/example-noop] registered");
}

export function unregister(): void {
  registered = false;
  console.log("[mods/example-noop] unregistered");
}
