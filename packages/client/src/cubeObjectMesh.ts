// Custom full-cube mesh for "see-through SOLID" block types (currently
// just GLASS) that must bypass noa's terrain greedy-mesher entirely,
// rather than the regular per-face atlas-cube path every opaque/solid
// cube type uses (see game.ts's main registration loop).
//
// Root cause this works around, confirmed directly against noa-engine's
// own bundled mesher source (constructMeshMask in its terrain-mesher
// module) and its GitHub history (fenomas/noa issue #184, where the
// maintainer calls composing correctly across non-opaque terrain
// neighbors "a general problem" they hadn't resolved): the greedy
// mesher's neighbor-face-culling only ever emits a face when at least
// ONE side of a voxel pair is opaque (or literal air, block id 0) --
// confirmed live via its real culling test, `if (op0 && op1) continue`
// followed by `if (op0 || m1 === 0) {...} else if (op1 || m0 === 0)
// {...}` with no other branch. Two DIFFERENT non-opaque block types next
// to each other (glass next to water, in this project's case) fall
// through every branch and get NO face at all on either side -- not a
// one-off bug, an inherent limitation of this meshing algorithm, which
// assumes non-opaque-vs-non-opaque pairs are always the SAME
// seamlessly-merging substance (fluid-vs-identical-fluid). Reported live:
// glass fully submerged in water was invisible, and glass at the
// waterline only showed its (correctly air-adjacent) top face.
//
// The fix used here is the same one noa's own object-mesher already
// provides for cross/plant meshes (plantMesh.ts) -- registering via
// `blockMesh` takes a block OUT of the greedy-meshed terrain grid
// entirely and gives it its own always-rendered mesh, thin-instanced at
// every voxel holding that id, with NO neighbor-culling logic applied at
// all (confirmed in noa's objectMesher.js) -- so every glass voxel always
// shows all 6 of its own faces regardless of what's touching it. Solid
// neighbors (dirt, etc.) still correctly show their own face against
// glass separately, since THEIR geometry still goes through the normal
// greedy mesher, which still reads glass's `opaque: false` registration
// for that decision (unaffected by this file).
import * as BABYLON from "@babylonjs/core";
import { XrayFadePlugin } from "./blockShaders.js";

export function buildCubeObjectMesh(scene: BABYLON.Scene, name: string, textureUrl: string): BABYLON.Mesh {
  // Babylon's own box primitive (CreateBoxVertexData, confirmed by reading
  // its real source directly) rather than hand-rolled quads: its default
  // winding/normals are already guaranteed correct for the DEFAULT
  // sideOrientation (Mesh.FRONTSIDE), and with no `faceUV` option it
  // already gives every one of the 6 faces the SAME independent 0..1 UV
  // square -- exactly what a uniform (non-atlas) texture needs, with zero
  // risk of getting winding backwards by hand (which would otherwise make
  // the whole cube invisible from outside once backFaceCulling is on --
  // see that setting's own comment below).
  const vertexData = BABYLON.CreateBoxVertexData({ size: 1 });
  // CreateBox centers on (0,0,0), spanning -0.5..0.5 on every axis.
  // noa's object-mesher instead expects X/Z centered on 0 but Y spanning
  // 0..1 (confirmed directly in plantMesh.ts's own header, the existing
  // cross-mesh precedent) -- shift Y by +0.5 and bake it into the raw
  // position data so the returned mesh's own local origin matches that
  // convention, rather than relying on a mesh-level transform (noa's
  // object-mesher reads raw vertex positions for its thin-instancing,
  // not a mesh transform).
  const positions = vertexData.positions as number[];
  for (let i = 1; i < positions.length; i += 3) positions[i] += 0.5;

  const mesh = new BABYLON.Mesh(`cube-object-${name}`, scene);
  vertexData.applyToMesh(mesh);

  const material = new BABYLON.StandardMaterial(`cube-object-${name}-mat`, scene);
  const texture = new BABYLON.Texture(textureUrl, scene, true, true, BABYLON.Texture.NEAREST_SAMPLINGMODE);
  texture.hasAlpha = true;
  material.diffuseTexture = texture;
  // Deliberately NOT backFaceCulling=false (unlike plantMesh.ts's cross
  // mesh, which genuinely needs double-sided rendering for a flat
  // sprite with no real "inside"). This is a real watertight cube --
  // leaving Babylon's own default (backFaceCulling=true) means each
  // face only ever renders from its outward side. Found live: with it
  // off, two adjacent glass blocks' touching internal faces (exactly
  // coincident planes -- the top block's bottom face and the block
  // below it's top face) each render BOTH their front and back, so two
  // coincident surfaces fight for the same depth (z-fighting, visible
  // through the cutout gaps). With backface culling on, only the
  // outward-facing side of each coincident pair ever renders -- no
  // second surface left to fight with.
  material.specularColor = new BABYLON.Color3(0, 0, 0);
  new XrayFadePlugin(material, "cutout");
  mesh.material = material;

  // Same static-buffer origin-shift fix plantMesh.ts's own build function
  // applies, for the same reason (noa's objectMesher.js creates the
  // thin-instance matrix buffer as non-updatable by default) -- see that
  // file's own doc comment for the full root-cause trace.
  mesh.thinInstanceAllowAutomaticStaticBufferRecreation = true;

  return mesh;
}
