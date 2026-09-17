# Vídeo de demonstração

Gravação automatizada do site em produção (Playwright + ffmpeg), com cursor e
legendas sobrepostas. Sem áudio.

- `agendafut-demo.mp4` — 1920×1080, ~66 s, para apresentação/projetor.
- `agendafut-demo-celular.mp4` — 780×1688 (retrato), mesmo roteiro, para WhatsApp/Instagram.

## Regenerar

```bash
cd docs/demo
npm i --no-save playwright && npx playwright install chromium
node record.mjs                                   # → out/raw.webm (1280×720 @2x)
W=390 H=844 OUT=out_mob node record.mjs           # versão celular
ffmpeg -i out/raw.webm -vf "scale=1920:1080:flags=lanczos,fps=30" \
  -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart agendafut-demo.mp4
```

Variáveis: `BASE` (URL do site; padrão é o GitHub Pages), `QUICK=1` (pausas
curtas, para testar o roteiro). O roteiro e as legendas ficam em `record.mjs`.
