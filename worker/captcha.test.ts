// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import sharp from 'sharp';
import { generate_image_from_text, initSync } from './captcha/captcha';

it('runs the vendored WASM renderer and produces a decodable multiline PNG without text chunks', async () => {
  const wasm = readFileSync(new URL('./captcha/captcha_bg.wasm', import.meta.url));
  initSync({ module: new WebAssembly.Module(wasm) });
  const text = 'river mountain sunlight garden forest '.repeat(10).trim();
  const png = generate_image_from_text(text);
  const metadata = await sharp(png).metadata();
  expect(metadata.format).toBe('png'); expect(metadata.width).toBe(720);
  expect(metadata.height).toBeGreaterThan(300);
  const chunks: string[] = [];
  const data = Buffer.from(png);
  for (let offset = 8; offset < data.length;) {
    const size = data.readUInt32BE(offset);
    chunks.push(data.toString('ascii', offset + 4, offset + 8));
    offset += size + 12;
  }
  expect(chunks).toContain('IDAT');
  expect(chunks).not.toContain('tEXt'); expect(chunks).not.toContain('iTXt');
  expect(data.includes(Buffer.from(text))).toBe(false);
});

it.each(['quiet river warm', 'mountain '.repeat(88).trim()])('keeps short and tall distorted passages inside an opaque image with clear outer margins (%#)', async text => {
  const wasm = readFileSync(new URL('./captcha/captcha_bg.wasm', import.meta.url));
  initSync({ module: new WebAssembly.Module(wasm) });
  const png = generate_image_from_text(text);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.width).toBe(720);
  expect(info.height).toBeGreaterThanOrEqual(84);
  expect(info.height).toBeLessThan(1200);
  let darkPixels = 0;
  let opaque = true;
  let clearEdges = true;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * 4;
      if (data[offset + 3] !== 255) opaque = false;
      if (data[offset] < 96) darkPixels++;
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
        if (data[offset] !== 255) clearEdges = false;
      }
    }
  }
  expect(opaque).toBe(true);
  expect(clearEdges).toBe(true);
  expect(darkPixels).toBeGreaterThan(text.length * 10);
  expect(Buffer.from(generate_image_from_text(text)).equals(Buffer.from(png))).toBe(false);
});
