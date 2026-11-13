// Build the LuxReal upload pack (LuxReal has no API — upload by hand at luxreal.ai/create-video).
// Usage: node scripts/luxreal-pack.mjs  → luxreal/pack/<fighter>/{mascot.png,poster.png,fighter-posed.glb} + luxreal/pack/arenas/*.jpg
import fs from "node:fs/promises";
import path from "node:path";
const root = new URL("..", import.meta.url).pathname;
const out = path.join(root, "luxreal/pack");
const ids = ["mug", "sneaker", "duck", "toaster", "cactus"];
const cp = async (a, b) => fs.copyFile(a, b).then(() => console.log("✓", path.relative(root, b))).catch(() => console.log("· missing", path.relative(root, a)));
for (const id of ids) {
  await fs.mkdir(path.join(out, id), { recursive: true });
  await cp(path.join(root, `public/fighters/${id}/mascot.png`), path.join(out, id, "mascot.png"));
  await cp(path.join(root, `public/posters/${id}/poster.png`), path.join(out, id, "poster.png"));
  await cp(path.join(root, `public/posters/${id}/posed.glb`), path.join(out, id, "fighter-posed.glb"));
  await cp(path.join(root, `public/fighters/${id}/rigged.glb`), path.join(out, id, "fighter-rigged.glb"));
}
await fs.mkdir(path.join(out, "arenas"), { recursive: true });
for (const a of ["kitchen-colosseum", "toy-shop", "rooftop-dojo"]) await cp(path.join(root, `public/arenas/${a}/pano.jpg`), path.join(out, "arenas", `${a}.jpg`));
