Diagnostics (not part of the regular test run).

* `gfx.mjs` boots the built game in headless Chrome and reports GPU limits, shader failures, faults and the renderer's
  fallback state. `QUALITY=<preset>`, `GLARGS` (Chrome GL flags), `INIT` (script injected before the page, e.g. to hide
  `EXT_color_buffer_float` and simulate a GPU without float colour buffers), `EVAL` (expression run after start).
* `oldsave.mjs <old checkout>` makes a save with an older build and loads it in the current `dist/`.
