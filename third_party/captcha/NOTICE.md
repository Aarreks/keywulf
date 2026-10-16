# CAPTCHA renderer provenance

Adapted from [xray-network/cloudflare-workers-captcha](https://github.com/xray-network/cloudflare-workers-captcha),
revision `c315b758baacc4c8968a624a884748ed7c5f2dfb`, Rust renderer under
`src/captcha-image-wasm/rust`. The upstream code's MIT license is preserved in
[LICENSE](LICENSE). This is a small upstream project, not an audited anti-bot service.

Keywulf changes: wrap a bounded word passage into a 720-pixel-wide image;
return PNG bytes directly; use six interference lines; disable unused image
codecs/base64 dependency. Replace the separately licensed upstream Panchang font
with Courier Prime Regular from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/courierprime).
The font's SIL Open Font License is in [FONT-LICENSE.txt](FONT-LICENSE.txt).
No upstream Panchang font or its restrictive font license is shipped.

The source and Cargo.lock are committed here. The generated JS, declarations and
302,403-byte WASM module are committed under `worker/captcha/`; ordinary app
builds and deploys require only Node, not Rust. Do not hand-edit generated files.
To rebuild from the repository root with Rust's `wasm32-unknown-unknown` target
and wasm-pack 0.15.0:

```sh
wasm-pack build third_party/captcha --target web --out-dir ../../worker/captcha --out-name captcha --no-pack
```

The current binary was built with Rust 1.99.1 and wasm-bindgen 0.2.129.
wasm-pack creates an output `.gitignore` containing `*`; remove that generated
file before adding regenerated runtime files. Keep build artifacts under
`third_party/captcha/target` ignored. Run `npm test -- worker/captcha.test.ts`
and a local Wrangler smoke test after rebuilding. The renderer is imported only
by Worker code; the browser bundle does not contain its answer or WASM module.
