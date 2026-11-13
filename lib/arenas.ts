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
  cover?: string;
  worldId?: string;
  prompt?: string;
  /** World job submitted but not finished yet (shown greyed out in the picker). */
  pending?: boolean;
}

export const BUILTIN_ARENAS: ArenaDef[] = [
  { id: "stage", name: "Neon Ring", source: "builtin", note: "Built-in stage" },
  {
    id: "sample-bear",
    name: "Aholo Sample Splat",
    source: "sample",
    note: "Official Aholo Viewer sample (.sog)",
    splatUrl: "https://holo-cos.aholo3d.cn/aholo-opensource/gs_file/bear/bear.3d71a266.sog",
    upAxis: "-Y",
    origin: [0, 0, 0],
    scale: 1,
  },
];
