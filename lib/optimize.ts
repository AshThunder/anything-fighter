/**
 * GLB post-processing for Lux3D outputs (server-side, gltf-transform + sharp).
 *  - fighter mesh: textures → ≤1024px WebP (Lux3D ships 2×PNG ≈ 8.5 MB), dedup/prune.
 *  - retarget animation GLBs: every file repeats the full mesh + textures (~21 MB each); we strip everything
 *    except the skeleton nodes + animation, giving tiny clip-only GLBs. Clips bind by bone name (mixamorig:*).
 */
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";

const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);

export async function optimizeFighterGlb(src: string, dst: string, maxTex = 1024) {
  const doc = await io().read(src);
  await doc.transform(
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [maxTex, maxTex], quality: 85 }),
    prune(),
  );
  await io().write(dst, doc);
}

export async function stripToAnimation(src: string, dst: string, clipName?: string) {
  const doc: Document = await io().read(src);
  const root = doc.getRoot();
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const m of root.listMaterials()) m.dispose();
  for (const t of root.listTextures()) t.dispose();
  if (clipName) root.listAnimations().forEach((a) => a.setName(clipName));
  await doc.transform(prune({ keepLeaves: true }));
  await io().write(dst, doc);
}

/** Downsize textures but keep their original format (for uploads to Aholo services that may not take WebP). */
export async function shrinkTextures(src: string, dst: string, maxTex = 1024) {
  const doc = await io().read(src);
  await doc.transform(dedup(), textureCompress({ encoder: sharp, resize: [maxTex, maxTex] }), prune());
  await io().write(dst, doc);
}
