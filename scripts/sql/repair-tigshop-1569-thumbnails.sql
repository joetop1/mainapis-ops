-- Run in the xiaolango.com Tigshop database only.
-- Scope: self-operated OPS product 1569; fill missing thumbnails only.
START TRANSACTION;

UPDATE product
SET pic_thumb = COALESCE(NULLIF(pic_original, ''), pic_url)
WHERE product_id = 1569 AND shop_id = 0
  AND product_sn LIKE 'OPS-%'
  AND (pic_thumb IS NULL OR TRIM(pic_thumb) = '')
  AND COALESCE(NULLIF(pic_original, ''), pic_url) LIKE 'https://%';
SELECT ROW_COUNT() AS product_thumbnails_filled;

UPDATE product_gallery AS g
JOIN product AS p ON p.product_id = g.product_id
SET g.pic_thumb = COALESCE(NULLIF(g.pic_original, ''), g.pic_url)
WHERE p.product_id = 1569 AND p.shop_id = 0 AND g.shop_id = 0
  AND p.product_sn LIKE 'OPS-%'
  AND (g.pic_thumb IS NULL OR TRIM(g.pic_thumb) = '')
  AND COALESCE(NULLIF(g.pic_original, ''), g.pic_url) LIKE 'https://%';
SELECT ROW_COUNT() AS gallery_thumbnails_filled;

UPDATE product_attributes AS a
JOIN product AS p ON p.product_id = a.product_id
SET a.attr_pic_thumb = a.attr_pic
WHERE p.product_id = 1569 AND p.shop_id = 0
  AND p.product_sn LIKE 'OPS-%'
  AND (a.attr_pic_thumb IS NULL OR TRIM(a.attr_pic_thumb) = '')
  AND a.attr_pic LIKE 'https://%';
SELECT ROW_COUNT() AS specification_thumbnails_filled;

COMMIT;
