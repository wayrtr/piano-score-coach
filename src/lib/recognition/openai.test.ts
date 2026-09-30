import {
  getRecognitionBaseUrl,
  getRecognitionClientOptions,
} from "@/lib/recognition/openai";

describe("openai recognition client config", () => {
  it("uses OPENAI_BASE_URL when present", () => {
    process.env.OPENAI_BASE_URL = "https://api.example.invalid/v1";

    const options = getRecognitionClientOptions("test-key");

    expect(getRecognitionBaseUrl()).toBe("https://api.example.invalid/v1");
    expect(options).toMatchObject({
      apiKey: "test-key",
      baseURL: "https://api.example.invalid/v1",
    });

    delete process.env.OPENAI_BASE_URL;
  });
});
