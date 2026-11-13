// node scripts/bake-pose.mts <anim.orig.glb (full mesh+skin+clip)> <out.glb> [timeFraction=0.5]
import { bakePose } from "../lib/pose.ts";
const [src, out, frac = "0.5"] = process.argv.slice(2);
const { min, max } = await bakePose(src, out, Number(frac), Number(process.env.TARGET_H ?? 1.8));
console.log("bounds", min.map((x) => x.toFixed(3)), max.map((x) => x.toFixed(3)));
