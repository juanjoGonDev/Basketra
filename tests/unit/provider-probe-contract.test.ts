import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inflateSync } from "node:zlib";
import {
  AiProviderError,
  OpenAiCompatibleProvider,
} from "../../src/ai/provider.ts";

const EXPECTED_PROBE_TEXT = "BASKETRA OCR 4821";
const PROBE_FIXTURE_URL = new URL(
  "../../src/ai/fixtures/provider-probe.jpg",
  import.meta.url,
);

test("provider OCR probe sends the checked-in readable JPG fixture", async () => {
  let requestBody: unknown;
  const provider = new OpenAiCompatibleProvider(
    {
      baseUrl: new URL("http://provider.test/v1/"),
      model: "test-model",
    },
    (async (input, init) => {
      requestBody = await new Request(input, init).json();
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  image: { format: "png", text: EXPECTED_PROBE_TEXT },
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  );

  await provider.testConnection();

  const body = asRecord(requestBody);
  const messages = asArray(body["messages"]);
  const systemMessage = asRecord(messages[0]);
  const userMessage = asRecord(messages[1]);
  const content = asArray(userMessage["content"]);
  assert.equal(
    String(systemMessage["content"]).includes(EXPECTED_PROBE_TEXT),
    false,
  );
  assert.equal(
    String(asRecord(content[0])["text"]).includes(EXPECTED_PROBE_TEXT),
    false,
  );

  const imagePart = asRecord(content[1]);
  assert.equal(imagePart["filename"], "test.png");
  const image = asRecord(imagePart["image_url"]);
  assert.equal(image["detail"], "high");
  const dataUrl = String(image["url"]);
  assert.match(dataUrl, /^data:image\/png;base64,/u);

  const transmittedPng = Buffer.from(
    dataUrl.slice(dataUrl.indexOf(",") + 1),
    "base64",
  );
  const fixturePng = readFileSync(PROBE_FIXTURE_URL);
  assert.deepEqual(transmittedPng, fixturePng);
  assert.deepEqual(
    [...transmittedPng.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );

  const { bytesPerPixel, height, idat, indexedColor, palette, width } =
    readPngChunks(transmittedPng);
  assert.ok(width >= 600);
  assert.ok(height >= 120);
  assert.ok(width / height >= 2 && width / height <= 4);
  if (indexedColor) assert.ok(palette);
  const scanlines = inflateSync(Buffer.concat(idat));
  assert.equal(scanlines.byteLength, height * (1 + width * bytesPerPixel));
});

test("provider OCR probe rejects non-object nested image payloads", async () => {
  for (const image of ["not-an-object", null, []]) {
    const provider = new OpenAiCompatibleProvider(
      {
        baseUrl: new URL("http://provider.test/v1/"),
        model: "test-model",
      },
      (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ image }) } }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )) as typeof fetch,
    );

    await assert.rejects(
      () => provider.testConnection(),
      (error: unknown) =>
        error instanceof AiProviderError &&
        error.code === "AI_INVALID_RESPONSE",
    );
  }
});

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function readPngChunks(png: Buffer): Readonly<{
  bytesPerPixel: number;
  height: number;
  idat: Buffer[];
  indexedColor: boolean;
  palette: boolean;
  width: number;
}> {
  const idat: Buffer[] = [];
  let bytesPerPixel = 0;
  let height = 0;
  let indexedColor = false;
  let palette = false;
  let width = 0;
  let offset = 8;

  while (offset + 12 <= png.byteLength) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= png.byteLength);

    if (type === "IHDR") {
      assert.equal(length, 13);
      width = png.readUInt32BE(dataStart);
      height = png.readUInt32BE(dataStart + 4);
      assert.equal(png[dataStart + 8], 8);
      assert.equal(png[dataStart + 9], 2);
    } else if (type === "IDAT") {
      idat.push(png.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  assert.ok(width > 0);
  assert.ok(height > 0);
  assert.ok(bytesPerPixel > 0);
  assert.ok(idat.length > 0);
  return { bytesPerPixel, height, idat, indexedColor, palette, width };
}
