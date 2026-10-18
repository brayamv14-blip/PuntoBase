/**
 * Entrega optimizada de Cloudinary: formato y calidad automaticos (f_auto,q_auto)
 * y ancho acotado. Si la URL no es de Cloudinary se devuelve igual.
 */
export function cloudinaryImage(url: string, width: number): string {
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/f_auto,q_auto,w_${width}/`);
}

export function isCloudinaryUrl(url: string): boolean {
  return url.startsWith("https://res.cloudinary.com/");
}
