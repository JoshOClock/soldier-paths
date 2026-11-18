# Resize a photo for the site: at most 1600 px wide, JPEG, under 400 KB if possible.
#   python3 scripts/resize_image.py in.jpg out.jpg
import os, sys
from PIL import Image, ImageOps
src, dst = sys.argv[1], sys.argv[2]
im = ImageOps.exif_transpose(Image.open(src))
im = im.convert('RGB')
if im.width > 1600: im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
for q in (84, 76, 68, 60, 52):
    im.save(dst, 'JPEG', quality=q, optimize=True, progressive=True)
    if os.path.getsize(dst) < 400 * 1024: break
print(f'{dst}: {os.path.getsize(dst) // 1024} KB')
