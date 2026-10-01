// @vitest-environment node

import { zipSync, strToU8 } from "fflate";
import { DOMParser } from "@xmldom/xmldom";

import {
  extractMusicXmlSource,
  parseMusicXmlDocument,
} from "@/lib/musicxml/parser";

const DEMO_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work>
    <work-title>Prelude in C</work-title>
  </work>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key>
          <fifths>4</fifths>
          <mode>major</mode>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <staves>2</staves>
        <clef number="1">
          <sign>G</sign>
          <line>2</line>
        </clef>
        <clef number="2">
          <sign>F</sign>
          <line>4</line>
        </clef>
      </attributes>
      <note>
        <pitch>
          <step>E</step>
          <octave>4</octave>
        </pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch>
          <step>G</step>
          <octave>4</octave>
        </pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>4</duration>
      </backup>
      <note>
        <pitch>
          <step>C</step>
          <octave>3</octave>
        </pitch>
        <duration>4</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch>
          <step>F</step>
          <alter>1</alter>
          <octave>4</octave>
        </pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

const POLYPHONIC_PAGED_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work>
    <work-title>Layered Study</work-title>
  </work>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key>
          <fifths>0</fifths>
          <mode>major</mode>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <staves>1</staves>
      </attributes>
      <note>
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>4</duration>
      </backup>
      <note>
        <pitch>
          <step>G</step>
          <octave>4</octave>
        </pitch>
        <duration>4</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch>
          <step>D</step>
          <octave>5</octave>
        </pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
    </measure>
    <measure number="3">
      <print new-page="yes"/>
      <note>
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

const MUSICXML_WITH_REST = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><voice>1</voice><staff>1</staff>
      </note>
      <note>
        <rest/><duration>4</duration><voice>1</voice><staff>1</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration><voice>1</voice><staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

const GRAND_STAFF_WITH_LATE_TREBLE_ENTRY = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><staves>2</staves></attributes>
      <note>
        <rest/><duration>4</duration><voice>1</voice><staff>1</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>4</duration><voice>1</voice><staff>1</staff>
      </note>
      <backup><duration>8</duration></backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>4</duration><voice>2</voice><staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

const VOCAL_AND_PIANO_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="voice"><part-name>Voice</part-name></score-part>
    <score-part id="piano"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="voice">
    <measure number="0">
      <attributes><divisions>3</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch><duration>3</duration>
        <lyric number="1"><syllabic>single</syllabic><text>小</text></lyric>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch><duration>3</duration>
        <lyric number="1"><syllabic>single</syllabic><text>星</text><extend/></lyric>
      </note>
    </measure>
    <measure number="1">
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>3</duration></note>
    </measure>
    <measure number="2">
      <print new-page="yes"/>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>3</duration></note>
    </measure>
  </part>
  <part id="piano">
    <measure number="0">
      <attributes>
        <divisions>2</divisions><staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><rest/><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>2</duration><voice>1</voice><staff>1</staff>
      </note>
      <note>
        <chord/><pitch><step>G</step><octave>4</octave></pitch>
        <duration>2</duration><voice>1</voice><staff>1</staff>
      </note>
      <backup><duration>4</duration></backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>4</duration><voice>2</voice><staff>2</staff>
      </note>
    </measure>
    <measure number="1">
      <print new-page="yes"/>
      <attributes><divisions>4</divisions></attributes>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>4</duration><voice>1</voice><staff>1</staff>
      </note>
      <backup><duration>4</duration></backup>
      <note>
        <pitch><step>D</step><octave>3</octave></pitch>
        <duration>4</duration><voice>2</voice><staff>2</staff>
      </note>
    </measure>
    <measure number="2">
      <print new-page="yes"/>
      <attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration><voice>1</voice><staff>1</staff>
      </note>
      <backup><duration>4</duration></backup>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration><voice>2</voice><staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

describe("MusicXML parser", () => {
  it("parses key, title, notes, and chord groupings from plain MusicXML", () => {
    const parsed = parseMusicXmlDocument(DEMO_MUSICXML);

    expect(parsed.title).toBe("Prelude in C");
    expect(parsed.currentKey).toBe("E major");
    expect(parsed.pageCount).toBe(1);
    expect(parsed.objects).toEqual([
      expect.objectContaining({
        id: "mxo-m0001-s1-v1-o0001",
        type: "chord",
        staff: "treble",
        measure: 1,
        onset: 0,
        notes: ["E4", "G4"],
      }),
      expect.objectContaining({
        id: "mxo-m0001-s2-v2-o0001",
        type: "note",
        staff: "bass",
        measure: 1,
        onset: 0,
        notes: ["C3"],
      }),
      expect.objectContaining({
        id: "mxo-m0002-s1-v1-o0001",
        type: "note",
        staff: "treble",
        measure: 2,
        onset: 0,
        notes: ["F#4"],
      }),
    ]);
    expect(parsed.annotatedXmlText).toContain(
      'data-piano-coach-object-id="mxo-m0001-s1-v1-o0001"',
    );
    expect(parsed.annotatedXmlText).toContain(
      'data-piano-coach-object-id="mxo-m0002-s1-v1-o0001"',
    );
  });

  it("extracts the root MusicXML document from a compressed MXL archive", () => {
    const archive = zipSync({
      "META-INF": {
        "container.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="scores/main.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>`),
      },
      scores: {
        "main.musicxml": strToU8(DEMO_MUSICXML),
      },
    });

    const extracted = extractMusicXmlSource({
      buffer: Buffer.from(archive),
      fileName: "prelude.mxl",
    });

    expect(extracted.fileName).toBe("scores/main.musicxml");
    expect(extracted.xmlText).toContain("<score-partwise");
    expect(extracted.xmlText).toContain("<work-title>Prelude in C</work-title>");
  });

  it("keeps same-staff polyphonic voices separate instead of collapsing them into one chord", () => {
    const parsed = parseMusicXmlDocument(POLYPHONIC_PAGED_MUSICXML);

    expect(parsed.objects.slice(0, 2)).toEqual([
      expect.objectContaining({
        id: "mxo-m0001-s1-v1-o0001",
        type: "note",
        measure: 1,
        staff: "treble",
        notes: ["C5"],
      }),
      expect.objectContaining({
        id: "mxo-m0001-s1-v2-o0001",
        type: "note",
        measure: 1,
        staff: "treble",
        notes: ["G4"],
      }),
    ]);
  });

  it("preserves MusicXML page boundaries as logical practice pages", () => {
    const parsed = parseMusicXmlDocument(POLYPHONIC_PAGED_MUSICXML);

    expect(parsed.pageCount).toBe(2);
    expect(parsed.pages).toEqual([
      expect.objectContaining({
        pageIndex: 0,
        measureStart: 1,
        measureEnd: 2,
      }),
      expect.objectContaining({
        pageIndex: 1,
        measureStart: 3,
        measureEnd: 3,
      }),
    ]);
  });

  it("counts rests when deriving the next sounding event's onset", () => {
    const parsed = parseMusicXmlDocument(MUSICXML_WITH_REST);

    expect(parsed.objects).toEqual([
      expect.objectContaining({ notes: ["C4"], onset: 0 }),
      expect.objectContaining({ notes: ["E4"], onset: 8 }),
    ]);
  });

  it("returns grand-staff objects in sounding order instead of voice encounter order", () => {
    const parsed = parseMusicXmlDocument(GRAND_STAFF_WITH_LATE_TREBLE_ENTRY);

    expect(parsed.objects.map((object) => ({ notes: object.notes, onset: object.onset }))).toEqual([
      { notes: ["C3"], onset: 0 },
      { notes: ["E5"], onset: 4 },
    ]);
  });

  it("imports every part with unique staff ids, aligned beats, and intact lyrics", () => {
    const parsed = parseMusicXmlDocument(VOCAL_AND_PIANO_MUSICXML);

    expect(parsed.objects).toHaveLength(10);
    expect(new Set(parsed.objects.map((object) => object.id)).size).toBe(10);
    expect(parsed.objects.filter((object) => object.measure === 0)).toEqual([
      expect.objectContaining({
        id: "mxo-m0001-s1-v1-o0001", staff: "treble", onset: 0, notes: ["C5"],
      }),
      expect.objectContaining({
        id: "mxo-m0001-s3-v2-o0001", staff: "bass", onset: 0, notes: ["C3"],
      }),
      expect.objectContaining({
        id: "mxo-m0001-s1-v1-o0002", staff: "treble", onset: 12, notes: ["D5"],
      }),
      expect.objectContaining({
        id: "mxo-m0001-s2-v1-o0001", staff: "treble", onset: 12, notes: ["E4", "G4"],
      }),
    ]);
    expect(parsed.objects.find((object) => object.id === "mxo-m0002-s3-v2-o0001"))
      .toEqual(expect.objectContaining({ staff: "bass", onset: 0, notes: ["D3"] }));
    expect(parsed.objects.find((object) => object.id === "mxo-m0003-s3-v2-o0001"))
      .toEqual(expect.objectContaining({ staff: "treble", onset: 0, notes: ["E4"] }));

    const annotated = new DOMParser().parseFromString(parsed.annotatedXmlText, "application/xml");
    const lyrics = Array.from(annotated.getElementsByTagName("lyric"));
    expect(lyrics.map((lyric) => lyric.getElementsByTagName("text")[0].textContent))
      .toEqual(["小", "星"]);
    expect(lyrics[1].getElementsByTagName("extend")).toHaveLength(1);
    expect(lyrics.map((lyric) => (lyric.parentNode as Element).getAttribute("data-piano-coach-object-id")))
      .toEqual(["mxo-m0001-s1-v1-o0001", "mxo-m0001-s1-v1-o0002"]);
    expect(Array.from(annotated.getElementsByTagName("note"))
      .filter((note) => note.getElementsByTagName("pitch").length > 0)
      .every((note) => note.hasAttribute("data-piano-coach-object-id"))).toBe(true);
  });

  it("merges page breaks across parts and uses ordinal page ranges for a pickup", () => {
    const parsed = parseMusicXmlDocument(VOCAL_AND_PIANO_MUSICXML);

    expect(parsed.pageCount).toBe(3);
    expect(parsed.pages.map((page) => ({
      pageIndex: page.pageIndex,
      measureStart: page.measureStart,
      measureEnd: page.measureEnd,
      objects: page.objects.length,
    }))).toEqual([
      { pageIndex: 0, measureStart: 1, measureEnd: 1, objects: 4 },
      { pageIndex: 1, measureStart: 2, measureEnd: 2, objects: 3 },
      { pageIndex: 2, measureStart: 3, measureEnd: 3, objects: 3 },
    ]);
    expect(parsed.pages.every((page) =>
      page.objects.every((object) => object.pageIndex === page.pageIndex),
    )).toBe(true);
  });
});


describe("MusicXML input boundaries", () => {
  const scoreWithPitch = (pitch: string, attributes = "<divisions>1</divisions>") =>
    `<score-partwise><part id="P1"><measure number="1"><attributes>${attributes}</attributes>
      <note><pitch>${pitch}</pitch><duration>1</duration></note>
    </measure></part></score-partwise>`;

  it.each(["0.5", "-0.5", "3", "1garbage"])(
    "rejects unsupported pitch alteration %s rather than displaying the wrong piano key",
    (alter) => {
      expect(() => parseMusicXmlDocument(scoreWithPitch(
        `<step>C</step><alter>${alter}</alter><octave>4</octave>`,
      ))).toThrow(/pitch/i);
    },
  );

  it.each([
    "<step>H</step><octave>4</octave>",
    "<step>C</step>",
    "<octave>4</octave>",
    "<step>C</step><octave>4oops</octave>",
    "<step>C</step><octave>9007199254740992</octave>",
  ])("rejects invalid pitch data: %s", (pitch) => {
    expect(() => parseMusicXmlDocument(scoreWithPitch(pitch))).toThrow(/pitch/i);
  });

  it("rejects divisions whose common tick resolution would lose precision", () => {
    const xml = `<score-partwise>
      ${[99999989, 99999971].map((divisions, index) => `
        <part id="P${index}"><measure number="1"><attributes><divisions>${divisions}</divisions></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
        </measure></part>`).join("")}
      </score-partwise>`;
    expect(() => parseMusicXmlDocument(xml)).toThrow(/resolution/i);
  });

  it.each(["0", "-1", "2garbage", "9007199254740992"])(
    "rejects invalid divisions %s instead of silently changing timing",
    (divisions) => {
      expect(() => parseMusicXmlDocument(scoreWithPitch(
        "<step>C</step><octave>4</octave>", `<divisions>${divisions}</divisions>`,
      ))).toThrow(/resolution/i);
    },
  );

  it.each(["-1", "2garbage", "9007199254740992"])(
    "rejects invalid duration %s instead of creating corrupt onset values",
    (duration) => {
      const xml = scoreWithPitch("<step>C</step><octave>4</octave>")
        .replace("<duration>1</duration>", `<duration>${duration}</duration>`);
      expect(() => parseMusicXmlDocument(xml)).toThrow(/resolution/i);
    },
  );

  it("does not treat MXL metadata as the score when no root file is declared", () => {
    const archive = zipSync({
      "META-INF/container.xml": strToU8("<container><rootfiles/></container>"),
      "META-INF/metadata.xml": strToU8("<metadata/>"),
      "score.xml": strToU8(DEMO_MUSICXML),
    });
    expect(extractMusicXmlSource({ buffer: Buffer.from(archive), fileName: "score.mxl" }))
      .toEqual({ fileName: "score.xml", xmlText: DEMO_MUSICXML });
  });

  it("rejects an archive containing only metadata", () => {
    const archive = zipSync({ "META-INF/container.xml": strToU8("<container/>") });
    expect(() => extractMusicXmlSource({ buffer: Buffer.from(archive), fileName: "score.mxl" }))
      .toThrow(/missing root MusicXML/i);
  });

  it("rejects malformed XML instead of importing a repaired partial document", () => {
    const invalid = scoreWithPitch("<step>C</step><octave>4</octave>")
      .replace("</measure>", "</wrong>");
    expect(() => parseMusicXmlDocument(invalid)).toThrow(/xml/i);
  });
});

// Patch only the ZIP directory, so oversized-entry tests never allocate a bomb.
function patchZipEntry(buffer: Buffer, name: string, patch: (offset: number) => void) {
  for (let offset = 0; offset <= buffer.length - 46; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = buffer.readUInt16LE(offset + 28);
    if (buffer.subarray(offset + 46, offset + 46 + nameLength).toString() === name) {
      patch(offset);
      return;
    }
  }
  throw new Error(`Missing test ZIP entry: ${name}`);
}

describe("bounded MXL extraction", () => {
  it("does not inflate unused attachments", () => {
    const archive = Buffer.from(zipSync({
      "score.musicxml": strToU8(DEMO_MUSICXML),
      "attachments/unused.bin": new Uint8Array([1, 2, 3]),
    }));
    patchZipEntry(archive, "attachments/unused.bin", (offset) => {
      archive.writeUInt16LE(99, offset + 10); // Unsupported compression, unused.
    });
    expect(extractMusicXmlSource({ buffer: archive, fileName: "score.mxl" }).xmlText)
      .toBe(DEMO_MUSICXML);
  });

  it.each([
    ["score.musicxml", 32 * 1024 * 1024 + 1],
    ["META-INF/container.xml", 1024 * 1024 + 1],
  ] as const)("rejects oversized %s before inflation", (name, size) => {
    const archive = Buffer.from(zipSync({
      "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>'),
      "score.musicxml": strToU8(DEMO_MUSICXML),
    }));
    patchZipEntry(archive, name, (offset) => archive.writeUInt32LE(size, offset + 24));
    expect(() => extractMusicXmlSource({ buffer: archive, fileName: "score.mxl" }))
      .toThrow(/size limit/i);
  });

  it("bounds stored ZIP entries even when originalSize is forged", () => {
    const oversized = "<container>" + " ".repeat(1024 * 1024) + "</container>";
    const archive = Buffer.from(zipSync({
      "META-INF/container.xml": strToU8(oversized),
      "score.musicxml": strToU8(DEMO_MUSICXML),
    }, { level: 0 }));
    patchZipEntry(archive, "META-INF/container.xml", (offset) => archive.writeUInt32LE(1, offset + 24));
    expect(() => extractMusicXmlSource({ buffer: archive, fileName: "score.mxl" }))
      .toThrow(/size limit/i);
  });

  it("honors a namespaced manifest and a nonstandard root filename", () => {
    const archive = Buffer.from(zipSync({
      "META-INF/container.xml": strToU8('<m:container xmlns:m="urn:oasis:names:tc:opendocument:xmlns:container"><m:rootfiles><m:rootfile full-path="music/score.data"/></m:rootfiles></m:container>'),
      "other.xml": strToU8("<not-a-score/>"),
      "music/score.data": strToU8(DEMO_MUSICXML),
    }));
    expect(extractMusicXmlSource({ buffer: archive, fileName: "score.MXL" }))
      .toEqual({ fileName: "music/score.data", xmlText: DEMO_MUSICXML });
  });
});
