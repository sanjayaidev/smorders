import { Router } from "express";
import { uploadImageToImgbb } from "../lib/imgbb.js";

const router = Router();

/**
 * POST /api/upload/image
 * Body: { image: string, name?: string }
 *
 * `image` can be either:
 *   - a base64 string (with or without a "data:image/...;base64," prefix), or
 *   - a publicly reachable image URL (ImgBB will fetch and re-host it)
 *
 * Response: { url, displayUrl, thumbUrl, deleteUrl }
 * `url` is the permanent public link - save that on the product record.
 */
router.post("/image", async (req, res, next) => {
  try {
    const { image, name } = req.body || {};
    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "Body must include an 'image' string." });
    }

    const result = await uploadImageToImgbb({ image, name });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
