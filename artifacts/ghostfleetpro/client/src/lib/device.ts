function getWebGLInfo(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return "no-webgl";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "no-ext";
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
    const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string;
    return `${vendor}:${renderer}`;
  } catch {
    return "webgl-err";
  }
}

function getCanvasHash(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-ctx";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.font = "11pt Arial";
    ctx.fillText("GhostFleetPro", 2, 15);
    ctx.fillStyle = "rgba(102,204,0,0.7)";
    ctx.font = "18pt Georgia";
    ctx.fillText("Lic", 4, 45);
    return canvas.toDataURL().slice(-50);
  } catch {
    return "canvas-err";
  }
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const FP_CACHE_KEY = "gfp_device_id";

export async function getDeviceFingerprint(): Promise<string> {
  const cached = localStorage.getItem(FP_CACHE_KEY);
  if (cached && cached.length === 64) return cached;

  const components = [
    String(navigator.hardwareConcurrency || 0),
    String((navigator as any).deviceMemory || 0),
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.platform || "unknown",
    getWebGLInfo(),
    getCanvasHash(),
  ];

  const fp = await sha256(components.join("|||"));
  localStorage.setItem(FP_CACHE_KEY, fp);
  return fp;
}

export const LICENSE_KEY = "gfp_licensed";

export function getCachedLicenseState(): boolean {
  return localStorage.getItem(LICENSE_KEY) === "1";
}

export function setCachedLicenseState(v: boolean) {
  if (v) localStorage.setItem(LICENSE_KEY, "1");
  else localStorage.removeItem(LICENSE_KEY);
}
