/**
 * Yüklemeden önce fotoğrafı tarayıcıda hazırlar:
 *  - En uzun kenarı 2400 px'e küçültür (fiş okunaklı kalır, dosya 8 MB sınırının çok altına iner)
 *  - JPEG'e çevirir: iPhone'un HEIC fotoğrafları da sunucunun kabul ettiği biçime döner
 *  - Fotoğrafın yönünü (EXIF) uygular ve konum dahil tüm üst veriyi atar (gizlilik)
 * Çözülemeyen bir dosyada, sunucunun zaten kabul ettiği türdense özgün dosyayı döndürür.
 */
const MAX_EDGE = 2400;
const QUALITY = 0.85;
const SERVER_OK = ["image/jpeg", "image/png", "image/webp"];
const SERVER_MAX = 8 * 1024 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}

export class ImagePrepError extends Error {}

export async function prepareImage(file: File): Promise<File> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    if (SERVER_OK.includes(file.type) && file.size <= SERVER_MAX) return file;
    throw new ImagePrepError("unreadable");
  }
  // Tarayıcı <img> çizerken EXIF yönünü uygular; naturalWidth/Height döndürülmüş boyutlardır.
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) throw new ImagePrepError("unreadable");
  const k = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.fillStyle = "#fff"; // saydam PNG'ler siyaha dönmesin
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", QUALITY));
  if (!blob) {
    if (SERVER_OK.includes(file.type) && file.size <= SERVER_MAX) return file;
    throw new ImagePrepError("unreadable");
  }
  const name = (file.name.replace(/\.[^.]+$/, "") || "fis") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}
