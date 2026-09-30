# Instrument sample attribution

The per-note `.mp3` files under `piano/` and `guitar-steel/` are decoded from
the **FluidR3_GM** soundfont, rendered to browser-ready samples by the
[gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) project.

FluidR3 © 2000-2002, 2008 Frank Wen. Distributed under the MIT license.

Regenerate with:

```bash
node scripts/build-instrument-samples.mjs
```
