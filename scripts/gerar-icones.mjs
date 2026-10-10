// Gera ícones do PWA e recortes da marca a partir de public/marca/. Rodar: node scripts/gerar-icones.mjs
import sharp from "sharp";

const BRANCO = "#ffffff";

async function recortar(arquivo) {
  const { data, info } = await sharp(arquivo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  return sharp(arquivo).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer();
}

// Símbolo FM (imagem 2: corredora + sombra preta + FM), sem distorcer
const simbolo = await recortar("public/marca/2-fm-sombra-preta.png");

async function icone(arquivo, lado, proporcao) {
  const alvo = Math.round(lado * proporcao);
  const img = await sharp(simbolo).resize({ width: alvo, height: alvo, fit: "inside" }).toBuffer();
  await sharp({ create: { width: lado, height: lado, channels: 4, background: BRANCO } })
    .composite([{ input: img, gravity: "center" }])
    .png()
    .toFile(`public/${arquivo}`);
}

await icone("pwa-64x64.png", 64, 0.82);
await icone("pwa-192x192.png", 192, 0.82);
await icone("pwa-512x512.png", 512, 0.82);
await icone("maskable-icon-512x512.png", 512, 0.62); // dentro da zona segura (círculo de 80%)
await icone("apple-touch-icon-180x180.png", 180, 0.78);
await icone("favicon-48x48.png", 48, 0.86);

// Recortes para as telas (sem a margem transparente)
await sharp(await recortar("public/marca/3-logo-fundo-escuro.png")).toFile("public/marca/logo-escura-recorte.png");
await sharp(await recortar("public/marca/1-logo-completa.png")).toFile("public/marca/logo-clara-recorte.png");
await sharp(simbolo).toFile("public/marca/simbolo-recorte.png");
