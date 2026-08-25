/**
 * Screen capture pipeline (v1.0 groundwork): desktopCapturer thumbnail ->
 * downscaled JPEG -> base64 data URL. Capture happens ONLY on explicit call.
 */
import { desktopCapturer, systemPreferences } from "electron";

const MAX_EDGE = 1280;

export async function captureScreenDataUrl(): Promise<string> {
  // Windows: screen capture permission is a no-op but call for future-proofing.
  if (process.platform === "darwin") {
    const status = systemPreferences.getMediaAccessStatus("screen");
    if (status !== "granted") throw new Error(`screen capture permission: ${status}`);
  }
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: MAX_EDGE, height: MAX_EDGE },
  });
  const primary = sources[0];
  if (!primary) throw new Error("no screen source available");
  const image = primary.thumbnail;
  const { width, height } = image.getSize();
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const scaled = scale < 1 ? image.resize({ width: Math.round(width * scale) }) : image;
  return `data:image/jpeg;base64,${scaled.toJPEG(70).toString("base64")}`;
}
