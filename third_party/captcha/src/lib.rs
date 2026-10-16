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
    // Extra line clearance keeps warped descenders distinct from the next row.
    let height = (lines.len() as u32 * 44) + 40;
    let mut rng = rand::thread_rng();
    let mut image = ImageBuffer::from_pixel(width, height, Rgba([255, 255, 255, 255]));
    for (line, text) in lines.iter().enumerate() {
        for mut glyph in font.layout(text, scale, point(24.0, 44.0 + line as f32 * 44.0)) {
            let origin = glyph.position();
            glyph.set_position(point(origin.x + rng.gen_range(-1.0..=1.0), origin.y + rng.gen_range(-2.0..=2.0)));
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
    let mut image = warp_text(&image, &mut rng);
    add_noise(&mut image, width, height);
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .encode(&image, width, height, image::ColorType::Rgba8).unwrap();
    png
}

fn warp_text(image: &ImageBuffer<Rgba<u8>, Vec<u8>>, rng: &mut impl Rng) -> ImageBuffer<Rgba<u8>, Vec<u8>> {
    let (width, height) = image.dimensions();
    let mut warped = ImageBuffer::from_pixel(width, height, Rgba([255, 255, 255, 255]));
    let horizontal_amplitude = rng.gen_range(3.0..=5.0);
    let vertical_amplitude = rng.gen_range(4.0..=6.0);
    let horizontal_period = rng.gen_range(45.0..=75.0);
    let vertical_period = rng.gen_range(90.0..=140.0);
    let horizontal_phase = rng.gen_range(0.0..std::f32::consts::TAU);
    let vertical_phase = rng.gen_range(0.0..std::f32::consts::TAU);
    // Precompute waves rather than evaluating trigonometry for every pixel.
    let horizontal: Vec<f32> = (0..height).map(|y| horizontal_amplitude *
        (y as f32 * std::f32::consts::TAU / horizontal_period + horizontal_phase).sin()).collect();
    let vertical: Vec<f32> = (0..width).map(|x| vertical_amplitude *
        (x as f32 * std::f32::consts::TAU / vertical_period + vertical_phase).sin()).collect();
    for y in 0..height {
        for x in 0..width {
            let sx = x as f32 + horizontal[y as usize];
            let sy = y as f32 + vertical[x as usize];
            if sx < 0.0 || sy < 0.0 || sx >= (width - 1) as f32 || sy >= (height - 1) as f32 { continue; }
            let (x0, y0) = (sx.floor() as u32, sy.floor() as u32);
            let (dx, dy) = (sx.fract(), sy.fract());
            // Inverse sampling with interpolation bends strokes without holes
            // or sharp pixel staircases that would make human reading harder.
            let top = image.get_pixel(x0, y0)[0] as f32 * (1.0 - dx) + image.get_pixel(x0 + 1, y0)[0] as f32 * dx;
            let bottom = image.get_pixel(x0, y0 + 1)[0] as f32 * (1.0 - dx) + image.get_pixel(x0 + 1, y0 + 1)[0] as f32 * dx;
            let shade = (top * (1.0 - dy) + bottom * dy).round() as u8;
            *warped.get_pixel_mut(x, y) = Rgba([shade, shade, shade, 255]);
        }
    }
    warped
}

fn add_noise(image: &mut ImageBuffer<Rgba<u8>, Vec<u8>>, width: u32, height: u32) {
    let mut rng = rand::thread_rng();
    let noise_amount = width * height / 24; // Consistent density for long passages.

    for _ in 0..noise_amount {
        let x = rng.gen_range(8..width - 8);
        let y = rng.gen_range(8..height - 8);

        let pixel = image.get_pixel_mut(x, y);
        let noise_value = rng.gen_range(0..=255) as u8;

        *pixel = Rgba([noise_value, noise_value, noise_value, 255]);
    }

    // Keep interference useful on tall passages, with a blank outer margin.
    for _ in 0..(height / 44).clamp(6, 20) {
        let x1 = rng.gen_range(8..width - 8);
        let y1 = rng.gen_range(8..height - 8);
        let x2 = rng.gen_range(8..width - 8);
        let y2 = rng.gen_range(8..height - 8);

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
