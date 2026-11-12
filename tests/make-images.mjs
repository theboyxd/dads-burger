// Cria as imagens de mentira que tests/api_tests.py envia para a rota de fotos (rodado por tests/run-tests.sh):
// uma foto de câmera com EXIF e rotação, um PNG com transparência, um WEBP e um PNG pequeno.
//   node tests/make-images.mjs <pasta>
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const dir = process.argv[2];
if (!dir) { console.error('uso: node tests/make-images.mjs <pasta>'); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });
const solid = (w, h, bg) => sharp({ create: { width: w, height: h, channels: bg.alpha === undefined ? 3 : 4, background: bg } });

// Foto de câmera: 4000x3000, gravada "deitada" com a orientação 6 (o celular girou) e com textos de EXIF que NÃO podem chegar ao site
await solid(4000, 3000, { r: 200, g: 90, b: 30 }).jpeg({ quality: 90 })
  .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'SECRET-EXIF-MARK', Artist: 'GPS-FAKE-LOCATION' } } })
  .toFile(path.join(dir, 'camera.jpg'));
// Logo com transparência
await solid(800, 800, { r: 0, g: 160, b: 60, alpha: 0.5 }).png().toFile(path.join(dir, 'alpha.png'));
await solid(2000, 1000, { r: 30, g: 90, b: 200 }).webp({ quality: 80 }).toFile(path.join(dir, 'photo.webp'));
await solid(100, 100, { r: 255, g: 255, b: 255 }).png().toFile(path.join(dir, 'plain.png'));
console.log('imagens de teste criadas em', dir);
