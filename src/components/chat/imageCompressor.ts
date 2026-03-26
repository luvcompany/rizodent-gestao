const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB

export async function compressImage(file: File): Promise<File> {
  if (file.size <= MAX_IMAGE_SIZE) return file;

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");

  // Scale down if very large
  let { width, height } = bitmap;
  const maxDim = 2048;
  if (width > maxDim || height > maxDim) {
    const ratio = Math.min(maxDim / width, maxDim / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";

  // Progressive quality reduction
  for (let quality = 0.85; quality >= 0.3; quality -= 0.1) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputType, quality)
    );
    if (blob && blob.size <= MAX_IMAGE_SIZE) {
      return new File([blob], file.name, { type: outputType });
    }
  }

  // Last resort: further scale down
  const ratio = 0.5;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outputType, 0.5)
  );
  if (blob) {
    return new File([blob], file.name, { type: outputType });
  }

  return file;
}
