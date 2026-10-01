/**
 * Opt-in synthetic parser/MXL benchmark; see README.md beside this file.
 * The old parser is retrieved from Git into ignored tmp/benchmarks/ at runtime.
 */
import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";

import { extractMusicXmlSource, parseMusicXmlDocument } from "@/lib/musicxml/parser";
import { measureWarmRuns, prepareBaselineModule, writeReport } from "./helpers";

it("compares complete parser output and selective MXL extraction with the baseline", async () => {
  const baselineModulePath = prepareBaselineModule("parser", "src/lib/musicxml/parser.ts");
  const baseline = await import(/* @vite-ignore */ baselineModulePath) as typeof import("@/lib/musicxml/parser");
  const measureCount = 600;
  const chordCount = measureCount * 8;
  const noteCount = chordCount * 4;
  const xml = `<score-partwise><part id="P1">${Array.from(
    { length: measureCount },
    (_, measure) => `<measure number="${measure + 1}"><attributes><divisions>4</divisions></attributes>${Array.from(
      { length: 8 },
      () => ["C", "E", "G", "B"].map(
        (step, index) => `<note>${index ? "<chord/>" : ""}<pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>`,
      ).join(""),
    ).join("")}</measure>`,
  ).join("")}</part></score-partwise>`;

  // Compare the full result, including annotated XML, IDs, onsets, pages,
  // object order and pitch/octave values, before collecting timing samples.
  expect(parseMusicXmlDocument(xml)).toEqual(baseline.parseMusicXmlDocument(xml));
  const parsing = {
    case: "MusicXML parsing",
    measureCount,
    chordCount,
    noteCount,
    identicalOutput: true,
    before: measureWarmRuns(() => baseline.parseMusicXmlDocument(xml)),
    after: measureWarmRuns(() => parseMusicXmlDocument(xml)),
  };

  const sample = '<score-partwise><part id="P1"><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>';
  const unusedAttachmentBytes = 16 * 1024 * 1024;
  const buffer = Buffer.from(zipSync({
    "score.musicxml": strToU8(sample),
    "attachments/unused.bin": new Uint8Array(unusedAttachmentBytes).fill(65),
  }));
  const input = { buffer, fileName: "sample.mxl" };
  expect(extractMusicXmlSource(input)).toEqual(baseline.extractMusicXmlSource(input));
  const extraction = {
    case: "MXL extraction with unused attachment",
    unusedAttachmentBytes,
    compressedBytes: buffer.length,
    identicalOutput: true,
    before: measureWarmRuns(() => baseline.extractMusicXmlSource(input)),
    after: measureWarmRuns(() => extractMusicXmlSource(input)),
  };
  writeReport("parser", [parsing, extraction]);
});
