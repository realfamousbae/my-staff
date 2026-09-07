import { describe, expect, it, vi } from "vitest";
import {
  providers,
  OpenAIRecognitionProvider,
  OpenAIArtworkProvider,
  type ProcessingInput,
} from "../src/processing/providers";

const input: ProcessingInput = {
  itemId: "eb664639-b52f-4f93-b854-e1a1e6b5c363",
  inputVersion: 1,
  category: "energy",
  catalog: [],
  media: [
    {
      id: "9600bf6f-87d0-4f3f-8fca-ec1206dbd6ae",
      mimeType: "image/png",
      bytes: Buffer.from("89504e470d0a1a0a", "hex"),
    },
  ],
};
describe("optional providers", () => {
  it("uses only local providers unless explicitly enabled", async () => {
    const selected = providers({ OPENAI_API_KEY: "not-used" });
    expect(selected.recognition.external).toBe(false);
    expect(selected.artwork.external).toBe(false);
    expect((await selected.artwork.render(input)).kind).toBe("result");
  });
  it("requires explicit models and a request limit before activation", () => {
    expect(() =>
      providers({ AI_ENABLED: "true", OPENAI_API_KEY: "not-used" }),
    ).toThrow("explicit model");
  });
  it("does not retry a timeout which could already have incurred cost", async () => {
    const request = vi.fn().mockRejectedValue(new Error("timeout"));
    const provider = new OpenAIRecognitionProvider(
      "test-only-key",
      "model-under-test",
      request,
    );
    expect((await provider.recognize(input)).kind).toBe("outcome_unknown");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects catalog IDs invented by the model", async () => {
    const result = {
      extracted: {
        brand: null,
        name: null,
        flavor: null,
        quantity: null,
        market: null,
        design: null,
      },
      candidates: [
        {
          editionId: "16d7966e-1bbb-49d6-80b6-f68d34ee1863",
          confidence: 0.99,
          reason: "test",
        },
      ],
    };
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: JSON.stringify(result) }],
            },
          ],
        }),
      ),
    );
    const provider = new OpenAIRecognitionProvider(
      "test-only-key",
      "model-under-test",
      request,
    );
    expect((await provider.recognize(input)).kind).toBe("outcome_unknown");
  });
  it("uses multipart edits and rejects non-image responses without a second call", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("not a PNG").toString("base64") }],
        }),
      ),
    );
    const provider = new OpenAIArtworkProvider(
      "test-only-key",
      "image-under-test",
      request,
    );
    expect((await provider.render(input)).kind).toBe("outcome_unknown");
    const body = request.mock.calls[0][1].body as FormData;
    expect(body.get("image")).toBeInstanceOf(Blob);
    expect(body.get("n")).toBe("1");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
