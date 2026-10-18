import { NextResponse } from "next/server";
import { getDeviceFromCookies } from "@/lib/auth";
import { CLOUDINARY_FOLDER, getCloudinaryConfig, signUploadParams } from "@/lib/cloudinary";

// POST /api/uploads/sign  firma una subida directa a Cloudinary (el secreto nunca sale del servidor)
export async function POST() {
  const device = await getDeviceFromCookies();
  if (!device) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = getCloudinaryConfig();
  if (!config) {
    return NextResponse.json({ error: "Cloudinary no está configurado en el servidor." }, { status: 501 });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signUploadParams({ folder: CLOUDINARY_FOLDER, timestamp }, config.apiSecret);

  return NextResponse.json({
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    folder: CLOUDINARY_FOLDER,
    timestamp,
    signature,
  });
}
