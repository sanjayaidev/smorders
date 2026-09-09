-- Adds photo support to categories, mirroring products.image_url.
-- Existing categories will have image_url = NULL, which the app treats as
-- "no photo yet" and falls back to the category's emoji icon.

alter table public.categories
  add column if not exists image_url text;
