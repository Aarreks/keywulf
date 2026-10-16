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
