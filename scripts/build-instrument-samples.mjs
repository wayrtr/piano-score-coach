// One-time asset builder: turn the open-source FluidR3_GM soundfont into the
// per-note mp3 files the practice player loads locally.
//
// Why this exists: playback used to be a Web Audio additive synth, which sounds
// like an electronic keyboard rather than a real instrument. FluidR3 ships an
// actual recorded sample for every semitone, so we decode those once here and
// commit them under public/samples/ — playback is then fully offline.
//
// Usage: node scripts/build-instrument-samples.mjs
//
// Source: https://github.com/gleitz/midi-js-soundfonts (MIT-licensed FluidR3_GM
// by Frank Wen). Each `<instrument>-mp3.js` assigns MIDI.Soundfont.<name> to an
// object mapping scientific-pitch note names ("A0", "Bb0", ...) to base64 mp3
// data URIs. We map each note to its MIDI number and write `<midi>.mp3`.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM";

// The instruments we ship, keyed by the folder name the player expects.
const INSTRUMENTS = [
  { folder: "piano", soundfont: "acoustic_grand_piano" },
  { folder: "guitar-steel", soundfont: "acoustic_guitar_steel" },
];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, "..");
const samplesRoot = join(projectRoot, "public", "samples");

const NOTE_BASE_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Note name like "A0", "Bb3", "C8" → MIDI number, or null if unparseable. */
function noteNameToMidi(noteName) {
  const match = noteName.match(/^([A-G])(b|#)?(-?\d+)$/);

  if (!match) {
    return null;
  }

  const [, letter, accidental, octaveRaw] = match;
  const octave = Number.parseInt(octaveRaw, 10);
  let semitone = NOTE_BASE_OFFSETS[letter];

  if (accidental === "b") {
    semitone -= 1;
  } else if (accidental === "#") {
    semitone += 1;
  }

  return 12 * (octave + 1) + semitone;
}

/**
 * Pull every `"note": "data:audio/mp3;base64,...."` pair out of the soundfont
 * JS. The regex tolerates the stray `;base64=` typo that a couple of entries
 * carry in the upstream files, and whitespace around the colon.
 */
function extractNotes(sourceText) {
  const entryPattern =
    /"([A-G](?:b|#)?-?\d+)"\s*:\s*"data:audio\/mp3;base64[,=]([A-Za-z0-9+/=]+)"/g;
  const notes = [];
  let match;

  while ((match = entryPattern.exec(sourceText)) !== null) {
    const midi = noteNameToMidi(match[1]);

    if (midi === null) {
      continue;
    }

    notes.push({ midi, base64: match[2] });
  }

  return notes;
}

async function fetchSoundfont(soundfont) {
  const url = `${BASE_URL}/${soundfont}-mp3.js`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function buildInstrument({ folder, soundfont }) {
  const targetDir = join(samplesRoot, folder);
  await mkdir(targetDir, { recursive: true });

  const sourceText = await fetchSoundfont(soundfont);
  const notes = extractNotes(sourceText);

  if (notes.length === 0) {
    throw new Error(`No notes extracted for ${soundfont} — upstream format may have changed.`);
  }

  let written = 0;

  for (const { midi, base64 } of notes) {
    const buffer = Buffer.from(base64, "base64");

    if (buffer.length === 0) {
      continue;
    }

    await writeFile(join(targetDir, `${midi}.mp3`), buffer);
    written += 1;
  }

  console.log(`  ${folder}: wrote ${written} notes from ${soundfont}`);
  return written;
}

async function writeAttribution() {
  const text = `# Instrument sample attribution

The per-note \`.mp3\` files under \`piano/\` and \`guitar-steel/\` are decoded from
the **FluidR3_GM** soundfont, rendered to browser-ready samples by the
[gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) project.

FluidR3 © 2000-2002, 2008 Frank Wen. Distributed under the MIT license.

Regenerate with:

\`\`\`bash
node scripts/build-instrument-samples.mjs
\`\`\`
`;

  await writeFile(join(samplesRoot, "ATTRIBUTION.md"), text);
}

async function main() {
  await mkdir(samplesRoot, { recursive: true });
  console.log("Building instrument samples from FluidR3_GM…");

  for (const instrument of INSTRUMENTS) {
    await buildInstrument(instrument);
  }

  await writeAttribution();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
