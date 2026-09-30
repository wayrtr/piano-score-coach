import { runPageRecognitionJob } from "@/lib/recognition/jobs";
import { RECOGNITION_SCHEMA_VERSION } from "@/lib/recognition/schema-v0";

describe("recognition jobs", () => {
  it("marks schema validation failures as failed while preserving raw response", async () => {
    const result = await runPageRecognitionJob({
      workPageId: "page_1",
      pagePng: Buffer.from("not-used"),
      promptContext: {
        pageNumber: 1,
        sourceWidth: 1200,
        sourceHeight: 1800,
      },
      requestPageRecognition: async () => ({
        modelName: "gpt-5.4",
        responseId: "resp_1",
        outputText: JSON.stringify({
          version: RECOGNITION_SCHEMA_VERSION,
          pageNumber: 1,
          sourceWidth: 1200,
          sourceHeight: 1800,
          keyCandidate: "E major",
          timeSignatureCandidate: "4/4",
          objects: [
            {
              id: "obj_1",
              type: "rest",
              bbox: { x: 10, y: 20, width: 30, height: 40 },
              staff: "treble",
              measure: 1,
              notes: ["rest"],
              confidence: 0.7,
              source: "model",
            },
          ],
        }),
        rawResponse: {
          bodyText: "{\"id\":\"resp_1\"}",
          parsedBody: { id: "resp_1" },
          requestId: "req_1",
          status: 200,
        },
      }),
    });

    expect(result.recognitionStatus).toBe("failed");
    if (result.recognitionStatus !== "failed") {
      throw new Error("Expected recognition to fail schema validation.");
    }
    expect(result.rawResponse).toEqual({
      bodyText: "{\"id\":\"resp_1\"}",
      parsedBody: { id: "resp_1" },
      requestId: "req_1",
      status: 200,
    });
    expect(result.errorMessage).toContain("Invalid option");
  });
});
