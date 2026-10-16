use wasm_bindgen::prelude::*;
use image::{ImageBuffer, Rgba};
use rusttype::{Font, Scale, point};

use rand::Rng;

#[wasm_bindgen]
pub fn generate_image_from_text(text: &str) -> Vec<u8> {
    // Keywulf adaptation: wrap a bounded passage; keep upstream raster/noise code.
    let width = 720;
    let font_data = include_bytes!("../CourierPrime-Regular.ttf");
    let font = Font::try_from_bytes(font_data as &[u8]).unwrap();
    let scale = Scale::uniform(32.0);
    let mut lines: Vec<String> = vec![String::new()];
    for word in text.split_whitespace() {
        let last = lines.last_mut().unwrap();
        if !last.is_empty() && last.len() + word.len() + 1 > 38 {
            lines.push(word.to_string());
        } else {
            if !last.is_empty() { last.push(' '); }
            last.push_str(word);
        }
    }
    let height = (lines.len() as u32 * 40) + 40;
    let mut image = ImageBuffer::from_pixel(width, height, Rgba([255, 255, 255, 255]));
    for (line, text) in lines.iter().enumerate() {
        for glyph in font.layout(text, scale, point(24.0, 40.0 + line as f32 * 40.0)) {
            if let Some(bounds) = glyph.pixel_bounding_box() {
                glyph.draw(|x, y, coverage| {
                    let px = x as i32 + bounds.min.x;
                    let py = y as i32 + bounds.min.y;
                    if px >= 0 && py >= 0 && px < width as i32 && py < height as i32 {
                        let shade = (255.0 * (1.0 - coverage)) as u8;
                        *image.get_pixel_mut(px as u32, py as u32) = Rgba([shade, shade, shade, 255]);
                    }
                });
            }
        }
    }
    add_noise(&mut image, width, height);
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .encode(&image, width, height, image::ColorType::Rgba8).unwrap();
    png
}
fn add_noise(image: &mut ImageBuffer<Rgba<u8>, Vec<u8>>, width: u32, height: u32) {
    let mut rng = rand::thread_rng();
    let noise_amount = 5000; // Number of noise pixels

    for _ in 0..noise_amount {
        let x = rng.gen_range(0..width);
        let y = rng.gen_range(0..height);

        let pixel = image.get_pixel_mut(x, y);
        let noise_value = rng.gen_range(0..=255) as u8;

        *pixel = Rgba([noise_value, noise_value, noise_value, 255]);
    }

    // Optionally, add some random lines for more complexity
    for _ in 0..6 {
        let x1 = rng.gen_range(0..width);
        let y1 = rng.gen_range(0..height);
        let x2 = rng.gen_range(0..width);
        let y2 = rng.gen_range(0..height);

        draw_line(image, x1, y1, x2, y2, Rgba([0, 0, 0, 255]));
    }
}

fn draw_line(image: &mut ImageBuffer<Rgba<u8>, Vec<u8>>, x0: u32, y0: u32, x1: u32, y1: u32, color: Rgba<u8>) {
    let dx = (x1 as i32 - x0 as i32).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 as i32 - y0 as i32).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    let mut x0 = x0 as i32;
    let mut y0 = y0 as i32;

    loop {
        if x0 >= 0 && y0 >= 0 && (x0 as u32) < image.width() && (y0 as u32) < image.height() {
            let pixel = image.get_pixel_mut(x0 as u32, y0 as u32);
            *pixel = color;
        }

        if x0 == x1 as i32 && y0 == y1 as i32 { break; }
        let e2 = 2 * err;
        if e2 >= dy { err += dy; x0 += sx; }
        if e2 <= dx { err += dx; y0 += sy; }
    }
}