import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { vi } from "vitest";

import { GET as getOriginalPageImage } from "@/app/api/works/[workId]/pages/[pageId]/image/route";
import { GET as getDerivedMusicXml } from "@/app/api/works/[workId]/pages/[pageId]/musicxml/route";
import { GET as getImportedMusicXml } from "@/app/api/works/[workId]/musicxml/route";
import { POST as importWork } from "@/app/api/works/route";
import { getDatabase, getSqlite, resetTestDatabase } from "@/lib/db/client";
import { practiceStates, recognitionResults, scoreObjects, workPages, works } from "@/lib/db/schema";
import { scopeMusicXmlObjectId } from "@/lib/musicxml/shared";
import { createNormalizedScorePdf } from "@/lib/recognition/omr-input";
import {
  getRecognitionQueueSnapshot,
  getRecognitionQueueState,
} from "@/lib/recognition/queue";
import { getPracticeWorkDetail, rerunPracticePage } from "@/lib/works/practice";
import { createImportedWork, enqueueWorkPageRecognition } from "@/lib/works/service";

const PAGED_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work>
    <work-title>Page Study</work-title>
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
        <staves>1</staves>
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
    </measure>
    <measure number="2">
      <print new-page="yes"/>
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

describe("createImportedWork", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-musicxml-"));
    resetTestDatabase(root);
    process.env.PIANO_COACH_STORAGE_DIR = root;
  });

  afterEach(() => {
    delete process.env.PIANO_COACH_STORAGE_DIR;
    delete process.env.AUDIVERIS_COMMAND;
    delete process.env.FAKE_AUDIVERIS_MXL_SOURCE;
    delete process.env.FAKE_AUDIVERIS_OUTPUT_NAME;
  });

  it("imports MusicXML into logical practice pages without enqueuing visual recognition", async () => {
    const created = await createImportedWork({
      title: "Page Study",
      sourceType: "musicxml",
      files: [
        {
          fileName: "page-study.musicxml",
          buffer: Buffer.from(PAGED_MUSICXML),
        },
      ],
    });

    const work = created.work;
    expect(work).not.toBeNull();
    expect(work?.sourceType).toBe("musicxml");
    expect(work?.status).toBe("ready");

    const db = getDatabase({ root, environment: "test" });
    const workRow = db.select().from(works).get();
    const pageRows = db.select().from(workPages).all();
    const recognitionRows = db.select().from(recognitionResults).all();
    const objectRows = db.select().from(scoreObjects).all();

    expect(workRow?.currentKey).toBe("E major");
    expect(pageRows).toHaveLength(2);
    expect(pageRows.map((row) => row.pageIndex)).toEqual([0, 1]);
    expect(pageRows.every((row) => row.recognitionStatus === "succeeded")).toBe(true);
    expect(recognitionRows).toHaveLength(2);
    expect(recognitionRows.every((row) => row.modelName === "musicxml-import")).toBe(
      true,
    );
    expect(objectRows.map((row) => row.id)).toEqual([
      scopeMusicXmlObjectId(pageRows[0].id, "mxo-m0001-s1-v1-o0001"),
      scopeMusicXmlObjectId(pageRows[1].id, "mxo-m0002-s1-v1-o0001"),
    ]);
    expect(objectRows.map((row) => row.onset)).toEqual([0, 0]);

    const detail = getPracticeWorkDetail(workRow?.id ?? "", {
      root,
      environment: "test",
    });

    expect(detail?.currentKey).toBe("E major");
    expect(detail?.pageCount).toBe(2);
    expect(detail?.pages[0]).toMatchObject({
      renderMode: "musicxml",
      recognitionStatus: "succeeded",
      measureStart: 1,
      measureEnd: 1,
    });
    expect(detail?.pages[1]).toMatchObject({
      renderMode: "musicxml",
      recognitionStatus: "succeeded",
      measureStart: 2,
      measureEnd: 2,
    });
    expect(detail?.pages[0]?.objects[0]).toMatchObject({ notes: ["E4"], onset: 0 });
    expect(detail?.pages[1]?.objects[0]).toMatchObject({ notes: ["F#4"], onset: 0 });
  });

  it("keeps compressed MXL on the original structured import route", async () => {
    process.env.AUDIVERIS_COMMAND = path.join(root, "poison-audiveris");

    const created = await createImportedWork({
      title: "Compressed Page Study",
      sourceType: "musicxml",
      files: [
        {
          fileName: "page-study.mxl",
          buffer: createMxlBuffer(PAGED_MUSICXML),
        },
      ],
    });
    const workId = created.work?.id ?? "";
    const response = await getImportedMusicXml(new Request("http://localhost"), {
      params: Promise.resolve({ workId }),
    });

    expect(created.work).toMatchObject({
      sourceType: "musicxml",
      status: "ready",
      pageCount: 2,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<score-partwise");
    expect(
      getRecognitionQueueSnapshot().queued.some((job) => job.workId === workId),
    ).toBe(false);
    expect(
      getRecognitionQueueSnapshot().running.some((job) => job.workId === workId),
    ).toBe(false);
  });

  it.each([
    { sourceType: "musicxml", fileName: "broken.mxl", contents: "not a zip" },
    { sourceType: "musicxml", fileName: "broken.musicxml", contents: "<document/>" },
    { sourceType: "images", fileName: "broken.png", contents: "not an image" },
    { sourceType: "pdf", fileName: "broken.pdf", contents: "not a pdf" },
  ] as const)("cleans up a failed $fileName import without removing existing works", async (input) => {
    const existing = await createImportedWork({
      sourceType: "musicxml",
      files: [{ fileName: "existing.musicxml", buffer: Buffer.from(PAGED_MUSICXML) }],
    });

    await expect(createImportedWork({
      sourceType: input.sourceType,
      files: [{ fileName: input.fileName, buffer: Buffer.from(input.contents) }],
    })).rejects.toThrow();

    const db = getDatabase({ root, environment: "test" });
    expect(db.select().from(works).all().map((work) => work.id)).toEqual([existing.work?.id]);
    expect(db.select().from(workPages).all()).toHaveLength(2);
    expect(db.select().from(practiceStates).all()).toHaveLength(1);
    expect(fs.readdirSync(path.join(root, "works"))).toEqual([existing.work?.id]);
  });

  it("removes partial database rows and files if establishing a work fails", async () => {
    getSqlite({ root, environment: "test" }).exec(`
      CREATE TRIGGER fail_import_practice BEFORE INSERT ON practice_states
      BEGIN SELECT RAISE(ABORT, 'forced practice write failure'); END;
    `);

    await expect(createImportedWork({
      sourceType: "musicxml",
      files: [{ fileName: "score.musicxml", buffer: Buffer.from(PAGED_MUSICXML) }],
    })).rejects.toThrow();

    const db = getDatabase({ root, environment: "test" });
    expect(db.select().from(works).all()).toEqual([]);
    expect(db.select().from(workPages).all()).toEqual([]);
    expect(db.select().from(recognitionResults).all()).toEqual([]);
    expect(db.select().from(scoreObjects).all()).toEqual([]);
    expect(db.select().from(practiceStates).all()).toEqual([]);
    expect(fs.readdirSync(path.join(root, "works"))).toEqual([]);
  });

  it("returns a readable import error when the selected MusicXML cannot be parsed", async () => {
    const formData = new FormData();
    const invalidFile = new File(["<document/>"], "broken.musicxml", { type: "application/xml" });
    Object.defineProperty(invalidFile, "arrayBuffer", {
      value: async () => new TextEncoder().encode("<document/>").buffer,
    });
    formData.set("sourceType", "musicxml");
    formData.set("musicxml", invalidFile);

    const response = await importWork({ formData: async () => formData } as Request);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "MusicXML 导入失败。请确认文件能正常打开，或重新导出后再试；若文件正常，请检查本机存储空间。",
    });
    expect(fs.readdirSync(path.join(root, "works"))).toEqual([]);
  });

  it("turns image pages into a derived MusicXML score without changing their source type", async () => {
    const sourceMxlPath = path.join(root, "audiveris-output.musicxml");

    fs.writeFileSync(sourceMxlPath, PAGED_MUSICXML);
    process.env.AUDIVERIS_COMMAND = createFakeAudiverisExecutable(root);
    process.env.FAKE_AUDIVERIS_MXL_SOURCE = sourceMxlPath;

    const created = await createImportedWork({
      title: "Scanned Page Study",
      sourceType: "images",
      files: [
        {
          fileName: "page-1.png",
          buffer: await createTestPng(600, 900),
        },
        {
          fileName: "page-2.png",
          buffer: await createTestPng(600, 900),
        },
      ],
    });

    await getRecognitionQueueState().queue.onIdle();

    const detail = getPracticeWorkDetail(created.work?.id ?? "", {
      root,
      environment: "test",
    });
    const db = getDatabase({ root, environment: "test" });
    const pageRows = db.select().from(workPages).orderBy(workPages.pageIndex).all();

    expect(detail).toMatchObject({
      sourceType: "images",
      status: "ready",
      pageCount: 2,
    });
    expect(detail?.pages.map((page) => page.renderMode)).toEqual([
      "musicxml",
      "musicxml",
    ]);
    expect(detail?.pages[0]?.objects[0]).toMatchObject({ notes: ["E4"], measure: 1 });
    expect(detail?.pages[1]?.objects[0]).toMatchObject({ notes: ["F#4"], measure: 2 });
    expect(detail?.pages[0]).toMatchObject({
      fallbackImageSrc: expect.stringContaining("/image"),
    });
    expect(pageRows.every((page) => page.imagePath.endsWith(".png"))).toBe(true);
    expect(pageRows.every((page) => Boolean(page.musicXmlPath))).toBe(true);
  });

  it("turns a PDF into derived MXL without making a network request", async () => {
    const sourcePagePath = path.join(root, "source-page.png");
    const sourcePdfPath = path.join(root, "source-score.pdf");
    const sourceMxlPath = path.join(root, "audiveris-output.mxl");
    const onePageMusicXml = PAGED_MUSICXML.replace('<print new-page="yes"/>', "");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network access is forbidden in local OMR tests."),
    );

    fs.writeFileSync(sourcePagePath, await createTestPng(600, 900));
    await createNormalizedScorePdf({
      pageImagePaths: [sourcePagePath],
      outputPath: sourcePdfPath,
    });
    fs.writeFileSync(sourceMxlPath, createMxlBuffer(onePageMusicXml));
    process.env.AUDIVERIS_COMMAND = createFakeAudiverisExecutable(root);
    process.env.FAKE_AUDIVERIS_MXL_SOURCE = sourceMxlPath;
    process.env.FAKE_AUDIVERIS_OUTPUT_NAME = "recognized.mxl";

    try {
      const created = await createImportedWork({
        title: "PDF Page Study",
        sourceType: "pdf",
        files: [
          {
            fileName: "page-study.pdf",
            buffer: fs.readFileSync(sourcePdfPath),
          },
        ],
      });

      await getRecognitionQueueState().queue.onIdle();

      const detail = getPracticeWorkDetail(created.work?.id ?? "", {
        root,
        environment: "test",
      });
      const page = detail?.pages[0];
      const routeContext = {
        params: Promise.resolve({
          workId: created.work?.id ?? "",
          pageId: page?.id ?? "",
        }),
      };
      const musicXmlResponse = await getDerivedMusicXml(
        new Request("http://localhost"),
        routeContext,
      );
      const imageResponse = await getOriginalPageImage(
        new Request("http://localhost"),
        routeContext,
      );

      expect(detail).toMatchObject({
        sourceType: "pdf",
        status: "ready",
        pageCount: 1,
      });
      expect(page).toMatchObject({
        renderMode: "musicxml",
        fallbackImageSrc: expect.stringContaining("/image"),
      });
      expect(musicXmlResponse.status).toBe(200);
      expect(await musicXmlResponse.text()).toContain("<score-partwise");
      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get("content-type")).toBe("image/png");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps the original page available when local Audiveris is missing", async () => {
    process.env.AUDIVERIS_COMMAND = path.join(root, "missing-audiveris");

    const created = await createImportedWork({
      title: "Fallback Study",
      sourceType: "images",
      files: [
        {
          fileName: "page-1.png",
          buffer: await createTestPng(600, 900),
        },
      ],
    });

    await getRecognitionQueueState().queue.onIdle();

    const detail = getPracticeWorkDetail(created.work?.id ?? "", {
      root,
      environment: "test",
    });
    const pageRow = getDatabase({ root, environment: "test" })
      .select()
      .from(workPages)
      .get();

    expect(detail).toMatchObject({
      sourceType: "images",
      status: "failed",
    });
    expect(detail?.pages[0]).toMatchObject({
      renderMode: "image",
      recognitionStatus: "failed",
    });
    expect(detail?.pages[0]?.recognition?.errorMessage).toContain(
      "未找到 Audiveris",
    );
    expect(pageRow?.musicXmlPath).toBeNull();
    expect(pageRow?.imagePath.endsWith(".png")).toBe(true);
    expect(fs.existsSync(pageRow?.imagePath ?? "")).toBe(true);
  });

  it("keeps the last good score and user edits when a later rerun fails", async () => {
    const sourceMusicXmlPath = path.join(root, "audiveris-output.musicxml");

    fs.writeFileSync(sourceMusicXmlPath, PAGED_MUSICXML);
    process.env.AUDIVERIS_COMMAND = createFakeAudiverisExecutable(root);
    process.env.FAKE_AUDIVERIS_MXL_SOURCE = sourceMusicXmlPath;

    const created = await createImportedWork({
      title: "Safe Rerun Study",
      sourceType: "images",
      files: [
        {
          fileName: "page-1.png",
          buffer: await createTestPng(600, 900),
        },
        {
          fileName: "page-2.png",
          buffer: await createTestPng(600, 900),
        },
      ],
    });

    await getRecognitionQueueState().queue.onIdle();

    const db = getDatabase({ root, environment: "test" });
    const firstPage = db.select().from(workPages).orderBy(workPages.pageIndex).get();

    if (!firstPage) {
      throw new Error("Expected an imported page.");
    }

    const firstObject = db.select().from(scoreObjects).where(eq(scoreObjects.workPageId, firstPage.id)).get();

    if (!firstObject) {
      throw new Error("Expected an imported score object.");
    }

    db.update(scoreObjects).set({
      notesJson: JSON.stringify(["G4"]),
      source: "user",
    }).where(eq(scoreObjects.id, firstObject.id)).run();

    process.env.AUDIVERIS_COMMAND = path.join(root, "missing-audiveris");
    await rerunPracticePage({
      workId: created.work?.id ?? "",
      pageId: firstPage.id,
    });
    await getRecognitionQueueState().queue.onIdle();

    const detail = getPracticeWorkDetail(created.work?.id ?? "", {
      root,
      environment: "test",
    });

    expect(detail?.status).toBe("ready");
    expect(detail?.pages.map((page) => page.renderMode)).toEqual([
      "musicxml",
      "musicxml",
    ]);
    expect(detail?.pages[0]?.objects[0]).toMatchObject({
      notes: ["G4"],
      source: "user",
    });
  });

  it("refuses to enqueue or rerun MusicXML pages through the image recognition queue", async () => {
    const created = await createImportedWork({
      title: "Page Study",
      sourceType: "musicxml",
      files: [
        {
          fileName: "page-study.musicxml",
          buffer: Buffer.from(PAGED_MUSICXML),
        },
      ],
    });

    const db = getDatabase({ root, environment: "test" });
    const pageRow = db.select().from(workPages).orderBy(workPages.pageIndex).get();

    expect(pageRow).not.toBeUndefined();

    const enqueued = await enqueueWorkPageRecognition({
      workId: created.work?.id ?? "",
      pageId: pageRow?.id ?? "",
    });

    expect(enqueued).toBe(false);

    const enqueuePageRecognition = vi.fn().mockResolvedValue(undefined);
    const detail = await rerunPracticePage(
      {
        workId: created.work?.id ?? "",
        pageId: pageRow?.id ?? "",
      },
      {
        root,
        environment: "test",
        enqueuePageRecognition,
      },
    );

    expect(enqueuePageRecognition).not.toHaveBeenCalled();
    expect(detail?.pages[0]?.recognitionStatus).toBe("succeeded");
  });

  it("backfills onset for MusicXML objects imported before onset persistence existed", async () => {
    const created = await createImportedWork({
      title: "Legacy Page Study",
      sourceType: "musicxml",
      files: [
        {
          fileName: "legacy-page-study.musicxml",
          buffer: Buffer.from(PAGED_MUSICXML),
        },
      ],
    });
    const db = getDatabase({ root, environment: "test" });

    db.update(scoreObjects).set({ onset: null }).run();

    const detail = getPracticeWorkDetail(created.work?.id ?? "", {
      root,
      environment: "test",
    });

    expect(detail?.pages.flatMap((page) => page.objects).map((object) => object.onset)).toEqual([
      0,
      0,
    ]);
    expect(db.select().from(scoreObjects).all().map((row) => row.onset)).toEqual([0, 0]);
  });

  it("backfills onset for MusicXML objects that use the original annotated ids", async () => {
    const created = await createImportedWork({
      title: "Original Legacy Page Study",
      sourceType: "musicxml",
      files: [
        {
          fileName: "original-legacy-page-study.musicxml",
          buffer: Buffer.from(PAGED_MUSICXML),
        },
      ],
    });
    const db = getDatabase({ root, environment: "test" });
    const pageRows = db.select().from(workPages).orderBy(workPages.pageIndex).all();
    const objectRows = db
      .select()
      .from(scoreObjects)
      .all()
      .toSorted((left, right) => left.measure - right.measure);
    const legacyIds = ["mxo-0001-1-0001", "mxo-0002-1-0001"];
    const annotatedPath = pageRows[0]?.imagePath;

    expect(annotatedPath).toBeTruthy();
    expect(objectRows).toHaveLength(2);

    let annotatedXml = fs.readFileSync(annotatedPath ?? "", "utf8");

    for (let index = 0; index < objectRows.length; index += 1) {
      const objectRow = objectRows[index];
      const legacyId = legacyIds[index];
      const parsedObjectId = objectRow.id.split("::").at(-1);

      expect(parsedObjectId).toBeTruthy();
      expect(legacyId).toBeTruthy();

      annotatedXml = annotatedXml.replaceAll(parsedObjectId ?? "", legacyId ?? "");
      db.update(scoreObjects)
        .set({
          id: legacyId,
          workPageId: pageRows[0]?.id ?? objectRow.workPageId,
          onset: null,
        })
        .where(eq(scoreObjects.id, objectRow.id))
        .run();
    }

    for (const pageRow of pageRows.slice(1)) {
      db.delete(workPages).where(eq(workPages.id, pageRow.id)).run();
    }
    db.update(works)
      .set({ pageCount: 1 })
      .where(eq(works.id, created.work?.id ?? ""))
      .run();
    fs.writeFileSync(annotatedPath ?? "", annotatedXml);

    const detail = getPracticeWorkDetail(created.work?.id ?? "", {
      root,
      environment: "test",
    });

    expect(detail?.pages).toHaveLength(1);
    expect(detail?.pages.flatMap((page) => page.objects).map((object) => object.id)).toEqual(
      legacyIds,
    );
    expect(detail?.pages.flatMap((page) => page.objects).map((object) => object.onset)).toEqual([
      0,
      0,
    ]);
    expect(
      db
        .select()
        .from(scoreObjects)
        .all()
        .toSorted((left, right) => left.measure - right.measure)
        .map((row) => row.onset),
    ).toEqual([0, 0]);
  });

  it("scopes MusicXML object ids so the same score can be imported more than once", async () => {
    await createImportedWork({
      title: "Page Study A",
      sourceType: "musicxml",
      files: [
        {
          fileName: "page-study-a.musicxml",
          buffer: Buffer.from(PAGED_MUSICXML),
        },
      ],
    });

    await createImportedWork({
      title: "Page Study B",
      sourceType: "musicxml",
      files: [
        {
          fileName: "page-study-b.musicxml",
          buffer: Buffer.from(PAGED_MUSICXML),
        },
      ],
    });

    const db = getDatabase({ root, environment: "test" });
    const objectRows = db.select().from(scoreObjects).all();

    expect(objectRows).toHaveLength(4);
    expect(new Set(objectRows.map((row) => row.id)).size).toBe(4);
  });
});

function createFakeAudiverisExecutable(root: string) {
  const executablePath = path.join(root, "fake-audiveris.mjs");

  fs.writeFileSync(
    executablePath,
    `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("-output");
const outputRoot = args[outputIndex + 1];

fs.mkdirSync(outputRoot, { recursive: true });
fs.copyFileSync(
  process.env.FAKE_AUDIVERIS_MXL_SOURCE,
  path.join(outputRoot, process.env.FAKE_AUDIVERIS_OUTPUT_NAME || "recognized.musicxml"),
);
`,
  );
  fs.chmodSync(executablePath, 0o755);

  return executablePath;
}

function createMxlBuffer(xmlText: string) {
  return Buffer.from(
    zipSync({
      "META-INF": {
        "container.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="scores/score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>`, true),
      },
      scores: {
        "score.musicxml": strToU8(xmlText, true),
      },
    }),
  );
}

async function createTestPng(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "white",
    },
  }).png().toBuffer();
}
