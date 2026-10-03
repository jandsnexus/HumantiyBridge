/*
 * Bilder im Browser verkleinern und zu Cloudinary hochladen.
 * Ein 12-MB-Handyfoto wird so zu ca. 150–300 KB, bevor es das Gerät verlässt.
 */
import { CLOUDINARY } from "../js/config.js";

const MAX_INPUT_BYTES = 30 * 1024 * 1024;

async function decode(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) { /* Fallback unten (ältere Safari-Versionen) */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Verkleinert auf maxSize (längste Seite). WebP, wo der Browser es kann, sonst JPEG.
 * PNG mit Transparenz (z. B. Flaggen) bleibt PNG, wenn WebP nicht geht.
 */
export async function compressImage(file, maxSize = 1600, quality = 0.82) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Das ist keine Bilddatei.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("Das Bild ist größer als 30 MB.");

  const src = await decode(file);
  const w0 = src.width || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw new Error("Das Bild konnte nicht gelesen werden.");
  const scale = Math.min(1, maxSize / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  if (src.close) src.close();

  let blob = await toBlob(canvas, "image/webp", quality);
  // Safari ohne WebP-Export liefert stillschweigend PNG → dann JPEG (bzw. PNG bei Transparenz)
  if (!blob || blob.type !== "image/webp") {
    const keepPng = file.type === "image/png";
    blob = await toBlob(canvas, keepPng ? "image/png" : "image/jpeg", quality);
  }
  if (!blob) throw new Error("Das Bild konnte nicht umgewandelt werden.");
  return blob;
}

/** Lädt einen Blob zu Cloudinary hoch und gibt die https-Adresse zurück. */
export async function uploadToCloudinary(blob, onProgress) {
  const form = new FormData();
  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  form.append("file", blob, `bild.${ext}`);
  form.append("upload_preset", CLOUDINARY.uploadPreset);

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`;
  const res = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () => reject(new Error("Keine Verbindung zu Cloudinary."));
    xhr.ontimeout = () => reject(new Error("Zeitüberschreitung beim Hochladen."));
    xhr.timeout = 60000;
    xhr.send(form);
  });

  let body = null;
  try { body = JSON.parse(res.responseText); } catch (e) { /* unten behandelt */ }
  if (res.status < 200 || res.status >= 300 || !body?.secure_url) {
    const msg = body?.error?.message || `Fehler ${res.status}`;
    throw new Error(`Upload fehlgeschlagen: ${msg}`);
  }
  return body.secure_url;
}

/** Komplett: verkleinern + hochladen. */
export async function processAndUpload(file, maxSize, onProgress) {
  const blob = await compressImage(file, maxSize);
  return uploadToCloudinary(blob, onProgress);
}
