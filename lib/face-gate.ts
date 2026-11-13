"use client";

/**
 * Client-side face gate for optional public photo sharing.
 * Fail closed: if the model can't load or detection throws, treat it as "error"
 * so the forge still runs but the photo stays private.
 */

type FaceDetector = {
  detect: (image: HTMLImageElement | ImageBitmap | HTMLCanvasElement) => { detections: unknown[] };
};

let detectorPromise: Promise<FaceDetector | null> | null = null;

async function getDetector(): Promise<FaceDetector | null> {
  if (typeof window === "undefined") return null;
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm");
      return (await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        },
        runningMode: "IMAGE",
        minDetectionConfidence: 0.5,
      })) as unknown as FaceDetector;
    })().catch((e) => {
      console.warn(`[face-gate] model failed to load: ${e instanceof Error ? e.message : e}`);
      detectorPromise = null;
      return null;
    });
  }
  return detectorPromise;
}

export type FaceGateResult = "yes" | "no" | "error";

export async function photoHasFace(source: Blob | HTMLImageElement | ImageBitmap): Promise<FaceGateResult> {
  try {
    const det = await getDetector();
    if (!det) return "error";
    let image: HTMLImageElement | ImageBitmap = source as ImageBitmap | HTMLImageElement;
    if (source instanceof Blob) image = await createImageBitmap(source);
    const result = det.detect(image);
    return result.detections.length > 0 ? "yes" : "no";
  } catch (e) {
    console.warn(`[face-gate] detect failed: ${e instanceof Error ? e.message : e}`);
    return "error";
  }
}
