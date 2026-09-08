import "dotenv/config";

const IMGBB_UPLOAD_URL = "https://api.imgbb.com/1/upload";

/**
 * Uploads an image to ImgBB and returns its public URL.
 *
 * @param {Object} params
 * @param {string} params.image - Base64-encoded image data (no "data:...;base64," prefix)
 *   OR a publicly reachable image URL. ImgBB accepts both via the same field.
 * @param {string} [params.name] - Optional filename (without extension) shown in the ImgBB UI.
 * @param {number} [params.expirationSeconds] - Optional auto-delete time (60 - 15552000 seconds).
 * @returns {Promise<{ url: string, displayUrl: string, deleteUrl: string, thumbUrl: string|null, id: string }>}
 */
export async function uploadImageToImgbb({ image, name, expirationSeconds }) {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing IMGBB_API_KEY. Set it in your environment (Railway -> Variables, or a local .env file)."
    );
  }
  if (!image) {
    throw new Error("No image provided.");
  }

  // Strip a data URL prefix if the caller sent one straight from a browser
  // <input type="file"> + FileReader.readAsDataURL(), e.g. "data:image/png;base64,....".
  const cleanImage = image.startsWith("data:")
    ? image.slice(image.indexOf(",") + 1)
    : image;

  const body = new URLSearchParams({ image: cleanImage });
  if (name) body.set("name", name);
  if (expirationSeconds) body.set("expiration", String(expirationSeconds));

  const response = await fetch(`${IMGBB_UPLOAD_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    const message =
      payload?.error?.message || `ImgBB upload failed with status ${response.status}`;
    throw new Error(message);
  }

  const { data } = payload;
  return {
    id: data.id,
    url: data.url, // direct, permanent image URL - store this one
    displayUrl: data.display_url, // same image, sometimes resized for display
    thumbUrl: data.thumb?.url ?? null,
    deleteUrl: data.delete_url, // keep this if you ever want to let an admin delete it
  };
}
