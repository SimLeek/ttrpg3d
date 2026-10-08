// Custom "cross" mesh for plant-type blocks (tall grass, dead shrub) --
// two thin crossing vertical slabs plus a bottom cap, exactly replicating
// the old game's real plant.obj geometry and its real decoded UVs (read
// directly from the old repo's shrub/tall_grass.obj -- not guessed). Those
// UVs index the SAME 3x2 texture-atlas grid as the regular cube mesh
// (dirt.obj) does, so this reuses the whole, unsliced atlas PNG as its
// texture rather than the per-face crops cube types use.
//
// Registered via noa's registerBlock({ blockMesh }) option, which expects
// a real Babylon Mesh (confirmed via noa-engine's objectMesher.js --
// `noa.registry._blockMeshLookup[id]` is passed straight to
// InstanceManager and added to the scene) -- noa thin-instances this one
// mesh at every voxel position holding that block ID, offsetting by
// (+0.5, 0, +0.5) per instance (confirmed in objectMesher.js's
// addInstance), which is why this mesh's x/z are centered on 0 rather
// than spanning 0..1 like a regular terrain-meshed cube.
import * as BABYLON from "@babylonjs/core";

// Each quad: 4 position vertices (x,y,z, already recentered so x/z span
// -0.5..0.5 and y spans 0..1 -- see header) and 4 UV pairs, taken directly
// from tall_grass.obj's own `v`/`vt` lines (minus the 0.5 x/z recenter).
// backFaceCulling is left off on the material instead of fixing winding
// per quad -- correct for a cross-sprite meant to be visible from any
// angle, and robust regardless of exact triangle order.
const QUADS: ReadonlyArray<{ positions: readonly number[]; uvs: readonly number[] }> = [
  {
    // Z-slab, front face (normal -Z)
    positions: [-0.5, 0, -0.01, -0.5, 1, -0.01, 0.5, 1, -0.01, 0.5, 0, -0.01],
    uvs: [0.998677, 0.001326, 0.998677, 0.498675, 0.665344, 0.498674, 0.665344, 0.001325],
  },
  {
    // X-slab, +X face
    positions: [0.01, 0, -0.5, 0.01, 1, -0.5, 0.01, 1, 0.5, 0.01, 0, 0.5],
    uvs: [0.997794, 0.5, 0.997793, 1.0, 0.666227, 1.0, 0.666227, 0.5],
  },
  {
    // Z-slab, back face (normal +Z)
    positions: [0.5, 0, 0.01, 0.5, 1, 0.01, -0.5, 1, 0.01, -0.5, 0, 0.01],
    uvs: [0.667111, 0.501326, 0.667111, 0.998675, 0.333778, 0.998674, 0.333778, 0.501325],
  },
  {
    // bottom cap (normal -Y)
    positions: [0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 0, -0.5],
    uvs: [0.334661, 0.5, 0.003095, 0.5, 0.003095, 0.0, 0.334661, 0.0],
  },
  {
    // X-slab, -X face
    positions: [-0.01, 0, 0.5, -0.01, 1, 0.5, -0.01, 1, -0.5, -0.01, 0, -0.5],
    uvs: [0.666228, 0.0, 0.666228, 0.5, 0.334661, 0.5, 0.334662, 0.0],
  },
];

export function buildCrossPlantMesh(scene: BABYLON.Scene, name: string, textureUrl: string): BABYLON.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const quad of QUADS) {
    const base = positions.length / 3;
    positions.push(...quad.positions);
    uvs.push(...quad.uvs);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const vertexData = new BABYLON.VertexData();
  vertexData.positions = positions;
  vertexData.uvs = uvs;
  vertexData.indices = indices;
  vertexData.normals = [];
  BABYLON.VertexData.ComputeNormals(positions, indices, vertexData.normals);

  const mesh = new BABYLON.Mesh(`plant-${name}`, scene);
  vertexData.applyToMesh(mesh);

  const material = new BABYLON.StandardMaterial(`plant-${name}-mat`, scene);
  const texture = new BABYLON.Texture(textureUrl, scene, true, true, BABYLON.Texture.NEAREST_SAMPLINGMODE);
  texture.hasAlpha = true;
  material.diffuseTexture = texture;
  material.backFaceCulling = false;
  material.specularColor = new BABYLON.Color3(0, 0, 0);
  mesh.material = material;

  // Root-caused via R&D into both noa-engine's and Babylon.js's actual
  // installed source (not guessed): noa's objectMesher.js creates this
  // mesh's thin-instance matrix buffer via
  // `mesh.thinInstanceSetBuffer('matrix', buffer)` with no 4th argument,
  // so Babylon defaults it to a STATIC (non-updatable) GPU buffer. Every
  // later position update -- in particular origin-shift rebase, which
  // mutates the buffer's CPU-side data in place and calls
  // `thinInstanceBufferUpdated('matrix')` -- ends up calling
  // `Buffer.prototype.updateDirectly`, which has NO else branch for a
  // non-updatable buffer: it silently does nothing. The CPU-side data is
  // correct (confirmed extensively live), but the GPU buffer is simply
  // never re-uploaded, so instances keep rendering at their pre-rebase
  // position until something else (e.g. the buffer growing) happens to
  // force a full recreation -- exactly the "grass jumps and stays
  // wrong exactly when the origin shifts" bug. This flag is Babylon's own
  // sanctioned fix for a static-buffer-then-updated mismatch: it makes
  // `thinInstanceBufferUpdated` recreate the GPU buffer (picking up
  // current data) whenever it finds the existing one isn't updatable,
  // instead of silently no-opping. Set directly on the mesh before
  // noa's object mesher ever touches it, since noa itself never sets it.
  mesh.thinInstanceAllowAutomaticStaticBufferRecreation = true;

  return mesh;
}
