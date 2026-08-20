import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = fileURLToPath(
  new URL("../public/assets/m2m-logo.png", import.meta.url),
);
const outputDirectory = new URL("../public/assets/", import.meta.url);

await mkdir(outputDirectory, { recursive: true });

const monogramCrop = await sharp(source)
  .extract({ left: 0, top: 0, width: 700, height: 400 })
  .png()
  .toBuffer();

const monogram = await sharp(monogramCrop)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .resize({ width: 430, height: 210, fit: "inside", kernel: "lanczos3" })
  .png()
  .toBuffer();

const icon512 = await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: { r: 12, g: 23, b: 53, alpha: 1 },
  },
})
  .composite([{ input: monogram, gravity: "centre" }])
  .png({ compressionLevel: 9, palette: false })
  .toBuffer();

const outputs = [
  ["m2m-icon-512.png", 512],
  ["m2m-icon-192.png", 192],
  ["apple-touch-icon.png", 180],
  ["m2m-favicon-32.png", 32],
  ["m2m-favicon-16.png", 16],
];

for (const [filename, size] of outputs) {
  await sharp(icon512)
    .resize(size, size, { fit: "fill", kernel: "lanczos3" })
    .png({ compressionLevel: 9, palette: size <= 32 })
    .toFile(fileURLToPath(new URL(filename, outputDirectory)));
}
