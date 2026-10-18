import { apiFetch } from "@/lib/api";

/** Reduce la foto del telefono antes de subirla (ahorra datos); Cloudinary hace el resto. */
async function shrink(file: File, maxSize = 1280): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.82)
    );
  } catch {
    return file;
  }
}

/** Sube la imagen a Cloudinary con una firma del servidor y devuelve su URL segura. */
export async function uploadProductImage(file: File): Promise<string> {
  const signRes = await apiFetch("/api/uploads/sign", { method: "POST" });
  const sign = await signRes.json().catch(() => ({}));
  if (!signRes.ok) throw new Error(sign.error ?? "No se pudo firmar la subida");

  const form = new FormData();
  form.append("file", await shrink(file));
  form.append("api_key", sign.apiKey);
  form.append("timestamp", String(sign.timestamp));
  form.append("folder", sign.folder);
  form.append("signature", sign.signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.secure_url) {
    throw new Error(json.error?.message ?? "No se pudo subir la imagen");
  }
  return json.secure_url as string;
}
