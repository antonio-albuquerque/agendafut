# Vídeo de demonstração

Gravação automatizada do site em produção (Playwright), com cursor e legendas
sobrepostos, narrada com a voz gratuita do Microsoft Edge (edge-tts) e
finalizada com ffmpeg.

- `agendafut-demo-narrado.mp4` — 1920×1080, ~83 s, para apresentação/projetor.
- `agendafut-demo-celular-narrado.mp4` — 1080×2340 (retrato 19,5:9, Full HD+),
  ~88 s, para WhatsApp/Instagram e celulares atuais.
- `agendafut-demo.srt` / `agendafut-demo-celular.srt` — cues das legendas com os
  tempos do vídeo, gerados pela gravação; são o roteiro da narração.
- `record.mjs` — roteiro da gravação (passos, legendas, cursor). O time de
  exemplo é o Palmeiras.

Os dois MP4 trazem a narração (AAC) e as legendas também como faixa de texto
(`mov_text`, pt-BR), além das legendas queimadas na imagem.

## Regenerar

Dependências: Node 22+, ffmpeg/ffprobe (`brew install ffmpeg`), Python 3.11+
com `edge-tts>=6.1` (`pip install "edge-tts>=6.1"`), rede (site + síntese).

```bash
cd docs/demo
npm i --no-save playwright && npx playwright install chromium

# 1. mede a fala de cada legenda (uma por linha) para dimensionar as janelas
grep -o "await caption('[^']*'" record.mjs | sed -E "s/await caption\('//; s/'$//; s/<[^>]+>//g" \
  | grep -v '^$' > cues.txt && echo "Escolha o time. Assine. Pronto." >> cues.txt
python3 ../../scripts/narrar-clipe.py --medir cues.txt \
  | python3 -c 'import json,sys; json.dump([round(c["duracao"]+0.6,2) for c in json.load(sys.stdin)], open("min-hold.json","w"))'

# 2. grava (cada legenda fica na tela pelo menos o tempo da sua fala) e emite o SRT
W=1920 H=1080 Z=1.5 OUT=out MIN_HOLD=min-hold.json CUES_OUT=agendafut-demo.srt node record.mjs
W=1080 H=2340 Z=3   OUT=out_mob MIN_HOLD=min-hold.json CUES_OUT=agendafut-demo-celular.srt node record.mjs
ffmpeg -i out/raw.webm     -vf fps=30 -c:v libx264 -crf 20 -pix_fmt yuv420p agendafut-demo.mp4
ffmpeg -i out_mob/raw.webm -vf fps=30 -c:v libx264 -crf 20 -pix_fmt yuv420p agendafut-demo-celular.mp4

# 3. narra: uma fala por cue, alinhada ao início da legenda; apara o tempo morto inicial
python3 ../../scripts/narrar-clipe.py agendafut-demo.mp4 agendafut-demo.srt \
  -o agendafut-demo-narrado.mp4 --aparar-inicio 1.2
python3 ../../scripts/narrar-clipe.py agendafut-demo-celular.mp4 agendafut-demo-celular.srt \
  -o agendafut-demo-celular-narrado.mp4 --aparar-inicio 1.2
```

`Z` é um zoom CSS: o Playwright não amplia a página para caber num vídeo maior
que a viewport, então a página é gerada em W/Z × H/Z px lógicos (1280×720 no
desktop, 360×780 no celular) e ampliada pelo navegador. Na gravação de celular
o CSS é servido com o breakpoint de desktop desativado, porque media queries
olham a largura real (1080 px), não a do layout. Outras variáveis: `BASE` (URL
do site; padrão é o GitHub Pages) e `QUICK=1` (pausas curtas, para testar).

`narrar-clipe.py` sintetiza cada cue com `pt-BR-ThalitaMultilingualNeural`
(`--voz` troca), sobe o `rate` em passos de 10% (até +30%) quando a fala não
cabe na janela até a legenda seguinte e, se ainda assim não couber, atrasa a
fala seguinte em vez de cortar ou sobrepor. Se o clipe tiver áudio próprio,
ele é abaixado sob a fala (`--ganho-fundo`). Os MP4 sem narração são
intermediários e não ficam no repositório.
