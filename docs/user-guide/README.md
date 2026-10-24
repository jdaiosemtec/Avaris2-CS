# Avaris2 CS User Guide (source)

`c1.html` … `c9.html` are the chapters, `shell_head.html` / `shell_tail.html` the page frame (navigation, search,
lightbox, dark mode). `python3 build.py` writes the single-page guide to `build/` (images converted to WebP);
upload the contents of `build/` to osemtec.com. Videos: keep `media/*.mp4` and `media/*.webm` in step (browsers play
the WebM first). Only update the guide when asked.

Website page: `python3 web/make_web.py` builds `web/out/avaris.html` (the osemtec.com template `web/avaris_template.html` with the guide's topics); upload the contents of `web/out/` to the website root (it adds `images/avaris2cs/` and `media/avaris2cs/`).
