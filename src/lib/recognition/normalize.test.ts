import {
  normalizeRecognitionPageArtifacts,
  summarizeObjectConfidence,
} from "@/lib/recognition/normalize";
import { RECOGNITION_SCHEMA_VERSION } from "@/lib/recognition/schema-v0";

describe("recognition normalization", () => {
  it("builds recognition and score-object records from a validated page payload", () => {
    const normalized = normalizeRecognitionPageArtifacts({
      workPageId: "page_1",
      modelName: "gpt-5.4",
      rawResponse: { id: "resp_1" },
      parsedPage: {
        version: RECOGNITION_SCHEMA_VERSION,
        pageNumber: 1,
        sourceWidth: 1200,
        sourceHeight: 1800,
        keyCandidate: "E major",
        timeSignatureCandidate: "4/4",
        objects: [
          {
            id: "obj_1",
            type: "note",
            bbox: { x: 10, y: 20, width: 30, height: 40 },
            staff: "treble",
            measure: 1,
            notes: ["E4"],
            confidence: 0.9,
            source: "model",
          },
          {
            id: "obj_2",
            type: "chord",
            bbox: { x: 50, y: 60, width: 32, height: 42 },
            staff: "bass",
            measure: 1,
            notes: ["C3", "E3", "G3"],
            confidence: 0.6,
            source: "model",
          },
        ],
      },
    });

    expect(normalized.keyCandidate).toBe("E major");
    expect(normalized.recognitionResult.version).toBe("schema-v0");
    expect(normalized.recognitionResult.confidenceSummary).toEqual({
      min: 0.6,
      max: 0.9,
      average: 0.75,
    });
    expect(normalized.scoreObjects).toHaveLength(2);
    expect(normalized.scoreObjects[0].workPageId).toBe("page_1");
    expect(normalized.scoreObjects[1].notes).toEqual(["C3", "E3", "G3"]);
  });

  it("can override object source when a rerun replaces one object", () => {
    const normalized = normalizeRecognitionPageArtifacts({
      workPageId: "page_1",
      modelName: "gpt-5.4",
      rawResponse: { id: "resp_2" },
      objectSource: "rerun",
      parsedPage: {
        version: RECOGNITION_SCHEMA_VERSION,
        pageNumber: 2,
        sourceWidth: 900,
        sourceHeight: 1400,
        keyCandidate: null,
        timeSignatureCandidate: null,
        objects: [
          {
            id: "obj_3",
            type: "note",
            bbox: { x: 12, y: 24, width: 18, height: 28 },
            staff: "treble",
            measure: 8,
            notes: ["B4"],
            confidence: 0.88,
            source: "model",
          },
        ],
      },
    });

    expect(normalized.scoreObjects[0].source).toBe("rerun");
  });

  it("summarizes empty object confidence safely", () => {
    expect(summarizeObjectConfidence([])).toEqual({
      min: 0,
      max: 0,
      average: 0,
    });
  });
});
