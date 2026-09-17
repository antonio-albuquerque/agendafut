# Vídeo de demonstração

Gravação automatizada do site em produção (Playwright + ffmpeg), com cursor e
legendas sobrepostas. Sem áudio.

- `agendafut-demo.mp4` — 1920×1080, ~67 s, para apresentação/projetor.
- `agendafut-demo-celular.mp4` — 780×1688 (retrato), mesmo roteiro, para WhatsApp/Instagram.

## Regenerar

```bash
cd docs/demo
npm i --no-save playwright && npx playwright install chromium
W=1920 H=1080 Z=1.5 OUT=out node record.mjs      # → out/raw.webm (layout 1280×720, zoom 1.5)
W=780 H=1688 Z=2 OUT=out_mob node record.mjs      # versão celular (layout 390×844, zoom 2)
ffmpeg -i out/raw.webm -vf fps=30 -c:v libx264 -crf 20 -pix_fmt yuv420p \
  -movflags +faststart agendafut-demo.mp4
```

`Z` é um zoom CSS: o Playwright não amplia a página para caber num vídeo maior
que a viewport, então a página é gerada já em W/Z × H/Z px lógicos e ampliada
pelo navegador. Outras variáveis: `BASE` (URL do site; padrão é o GitHub Pages)
e `QUICK=1` (pausas curtas, para testar o roteiro). O roteiro e as legendas
ficam em `record.mjs`; o time de exemplo é o Palmeiras.
