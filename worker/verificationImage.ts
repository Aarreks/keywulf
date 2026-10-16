import { generate_image_from_text, initSync } from './captcha/captcha';
import captchaWasm from './captcha/captcha_bg.wasm';

// Vendored xray-network/cloudflare-workers-captcha, with multiline layout and
// Courier Prime. Its existing Rust/WASM implementation renders the PNG/noise.
initSync({ module: captchaWasm });
const WORDS = ('after again almost along answer around autumn before below better beyond border bright bring ' +
  'calm carry center change clear close coast color corner could cover daily dawn decide deep distant dream ' +
  'early earth east empty evening every field find first follow forest fresh friend future garden gentle give ' +
  'glass golden great green ground grow harbor heart heavy high hills home hope house island journey keep ' +
  'kind lake later learn leave letter light little local long look lower morning mountain move near never ' +
  'night north notice ocean often open other outside paper path people place plain plant point quiet rain ' +
  'reach read reason river road round safe sail same sand season second shadow shape share short should ' +
  'silver simple small snow soft south space spring stand star still stone story stream street strong summer ' +
  'sunlight table take teach their there thing think through time together travel tree under valley voice ' +
  'wait walk warm water weather west where while white wide wind window winter within world write young').split(' ');

export function createVerificationPassage(requiredWpm: number): string {
  // At least twenty seconds of typing at the required speed, never a tiny burst.
  const minChars = Math.max(20, Math.ceil(requiredWpm * 5 / 3));
  const random = crypto.getRandomValues(new Uint32Array(160));
  const words: string[] = [];
  let length = 0;
  for (const value of random) {
    const word = WORDS[value % WORDS.length];
    words.push(word);
    length += word.length + 1;
    if (length - 1 >= minChars) break;
  }
  return words.join(' ');
}

export async function renderVerificationImage(text: string): Promise<Uint8Array> {
  if (!/^[a-z ]{1,800}$/.test(text)) throw new Error('Invalid verification passage');
  return generate_image_from_text(text);
}
