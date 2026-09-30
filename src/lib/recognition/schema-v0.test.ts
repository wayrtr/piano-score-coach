import {
  RECOGNITION_SCHEMA_VERSION,
  recognitionPageSchema,
  recognitionScoreObjectSchema,
} from "@/lib/recognition/schema-v0";

describe("recognition schema v0", () => {
  it("only accepts note, chord, or other as object types", () => {
    const baseObject = {
      id: "obj_1",
      bbox: { x: 10, y: 20, width: 30, height: 40 },
      staff: "treble",
      measure: 2,
      notes: ["E4"],
      confidence: 0.92,
      source: "model",
    };

    expect(
      recognitionScoreObjectSchema.safeParse({
        ...baseObject,
        type: "note",
      }).success,
    ).toBe(true);

    expect(
      recognitionScoreObjectSchema.safeParse({
        ...baseObject,
        type: "rest",
      }).success,
    ).toBe(false);
  });

  it("keeps confidence inside the 0 to 1 range", () => {
    expect(
      recognitionScoreObjectSchema.safeParse({
        id: "obj_1",
        type: "chord",
        bbox: { x: 10, y: 20, width: 30, height: 40 },
        staff: "bass",
        measure: 4,
        notes: ["C3", "E3", "G3"],
        confidence: 1.1,
        source: "model",
      }).success,
    ).toBe(false);
  });

  it("requires notes to stay in array form", () => {
    expect(
      recognitionScoreObjectSchema.safeParse({
        id: "obj_1",
        type: "note",
        bbox: { x: 10, y: 20, width: 30, height: 40 },
        staff: "treble",
        measure: 1,
        notes: "E4",
        confidence: 0.4,
        source: "model",
      }).success,
    ).toBe(false);
  });

  it("rejects empty note arrays", () => {
    expect(
      recognitionScoreObjectSchema.safeParse({
        id: "obj_1",
        type: "note",
        bbox: { x: 10, y: 20, width: 30, height: 40 },
        staff: "treble",
        measure: 1,
        notes: [],
        confidence: 0.4,
        source: "model",
      }).success,
    ).toBe(false);
  });

  it("requires bbox to match the pixel-coordinate contract", () => {
    expect(
      recognitionScoreObjectSchema.safeParse({
        id: "obj_1",
        type: "other",
        bbox: { x: 10, y: 20, height: 40 },
        staff: "treble",
        measure: 1,
        notes: ["rest"],
        confidence: 0.5,
        source: "model",
      }).success,
    ).toBe(false);
  });

  it("keeps the page schema version stable", () => {
    const parsed = recognitionPageSchema.parse({
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
          confidence: 0.95,
          source: "model",
        },
      ],
    });

    expect(parsed.version).toBe("schema-v0");
  });
});
