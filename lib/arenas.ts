/** Arena catalogue types (shared by server + client). */
export type ArenaSource = "builtin" | "spatialgen" | "reality" | "sample";

export interface ArenaDef {
  id: string;
  name: string;
  source: ArenaSource;
  note?: string;
  /** SpatialGen equirect panorama (assets.imagery.panoUrl, rehosted). */
  panoUrl?: string;
  /** 3DGS file (spz/ply/sog), rehosted. */
  splatUrl?: string;
  /** Up axis of the splat: "Z" (Aholo World output), "-Y" (OpenCV-style samples). */
  upAxis?: "Z" | "-Y" | "Y";
  /** Splat-space point that becomes the game origin (arena floor centre), and splat-units per game metre⁻¹. */
  origin?: [number, number, number];
  /** Game metres per splat unit. */
  scale?: number;
  /** Yaw (radians, around up) applied so the fight line faces a nice part of the room. */
  yaw?: number;
  /** Walkable half-width of the fight line in game metres (default 5). */
  half?: number;
  /** Splat URLs to try in order (direct Aholo CDN URL first, then the same-origin proxy). */
  splatUrls?: string[];
  cover?: string;
  worldId?: string;
  prompt?: string;
  /** World job submitted but not finished yet (shown greyed out in the picker). */
  pending?: boolean;
  /** Live Aholo world status for pending arenas (PENDING / RUNNING …) and 0–1 progress. */
  status?: string;
  progress?: number;
  /** RUNNING at 0% for a long time: Aholo's queue is stuck; the fight uses another arena meanwhile. */
  stuck?: boolean;
}

export const BUILTIN_ARENAS: ArenaDef[] = [
  { id: "stage", name: "Neon Ring", source: "builtin", note: "Built-in stage", cover: "/arenas/thumbs/stage.jpg" },
  {
    id: "sample-bear",
    name: "Aholo Sample Splat",
    source: "sample",
    note: "Official Aholo Viewer sample (.sog)",
    cover: "/arenas/thumbs/sample-bear.jpg",
    splatUrl: "https://holo-cos.aholo3d.cn/aholo-opensource/gs_file/bear/bear.3d71a266.sog",
    upAxis: "-Y",
    origin: [0, 0, 0],
    scale: 1,
  },
];

/**
 * Hand-checked splat placements (output of lib/splat-fit.ts, verified with headless screenshots at 390x844
 * and 1440x900). Worlds not listed here are auto-fitted server-side (lib/splat-placement.ts).
 */
export const SPLAT_PLACEMENT: Record<string, { origin: [number, number, number]; scale: number; yaw: number; half: number }> = {
  // auto-fit as-is: fight on the long kitchen floor, looking at the window wall
  "kitchen-colosseum": { origin: [-4.924, -0.031, -1.369], scale: 2.228, yaw: -1.571, half: 3.35 },
  // auto-fit wanted 6× (tiny scan) which blurs into mush; 3.5× looking at the bookshelf + window reads best
  "my-room": { origin: [0.548, 2.4, -0.911], scale: 3.5, yaw: 0, half: 2.5 },
  // auto-fit as-is: shelves of toys behind the fighters
  "toy-shop": { origin: [-0.46, -0.139, -0.96], scale: 2.951, yaw: 1.571, half: 3.822 },
  // outdoor: floor = roof just below the panorama eye (auto-fit), turned to face the city skyline
  "rooftop-dojo": { origin: [0, 0, -1.325], scale: 2, yaw: 1.571, half: 3 },
};
