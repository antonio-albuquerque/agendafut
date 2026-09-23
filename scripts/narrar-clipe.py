#!/usr/bin/env python3
"""Narra um clipe a partir das legendas: um trecho de fala por cue do SRT.

    narrar-clipe.py VIDEO LEGENDAS.srt -o SAIDA.mp4 [--voz VOZ] [--rate +0%]
    narrar-clipe.py --medir LEGENDAS.srt|TEXTO.txt      # só mede a duração de cada fala

Como funciona:
- cada cue vira um MP3 via edge-tts (vozes gratuitas do Microsoft Edge, sem
  chave), com o texto exato da legenda (tags HTML removidas);
- a fala começa no início da legenda. Se não couber na janela até a próxima
  legenda, o `rate` sobe em passos (até --max-boost); se ainda assim não
  couber, a fala seguinte é atrasada até esta terminar — nunca se cortam nem
  se sobrepõem trechos (o aviso sai no stderr para você alongar a legenda);
- ffmpeg posiciona os trechos, mistura com o áudio original do clipe (se
  houver, abaixado sob a fala) e grava o MP4 com a narração e as legendas
  também como faixa de texto (mov_text);
- `--aparar-inicio S` corta o começo do clipe deixando S segundos antes da
  primeira legenda (tira o tempo morto de carregamento) e desloca os cues.

Dependências: Python 3.11+, `pip install "edge-tts>=6.1"`, ffmpeg/ffprobe no
PATH (ou em /opt/homebrew/bin). Precisa de rede para a síntese.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

try:
    import edge_tts
except ImportError:  # pragma: no cover
    sys.exit('falta o pacote edge-tts: pip install "edge-tts>=6.1"')

VOZ_PADRAO = "pt-BR-ThalitaMultilingualNeural"
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
FFPROBE = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"


@dataclass
class Cue:
    idx: int
    start: float  # segundos
    end: float
    text: str


def _limpa(texto: str) -> str:
    texto = re.sub(r"<[^>]+>", "", texto)
    return re.sub(r"\s+", " ", texto).strip()


def _tempo(s: str) -> float:
    h, m, rest = s.strip().split(":")
    sec, ms = rest.replace(".", ",").split(",")
    return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000


def _fmt_tempo(t: float) -> str:
    ms = round(t * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def ler_cues(path: Path) -> list[Cue]:
    """SRT normal; ou, para --medir, um .txt com uma fala por linha."""
    raw = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    blocos = re.split(r"\n\s*\n", raw.strip())
    cues: list[Cue] = []
    for bloco in blocos:
        linhas = bloco.strip().split("\n")
        m = re.match(r"\s*(\S+)\s*-->\s*(\S+)", linhas[1] if len(linhas) > 1 else "")
        if not m:
            break
        texto = _limpa(" ".join(linhas[2:]))
        if texto:
            cues.append(Cue(len(cues) + 1, _tempo(m.group(1)), _tempo(m.group(2)), texto))
    if cues:
        return cues
    # texto simples: uma fala por linha, sem tempo (só para --medir)
    return [
        Cue(i + 1, 0.0, 0.0, _limpa(l))
        for i, l in enumerate(raw.split("\n"))
        if _limpa(l)
    ]


async def sintetizar(texto: str, voz: str, rate: str, destino: Path) -> None:
    mp3 = bytearray()
    async for chunk in edge_tts.Communicate(texto, voz, rate=rate).stream():
        if chunk["type"] == "audio":
            mp3.extend(chunk["data"])
    if not mp3:
        raise RuntimeError(f"edge-tts não devolveu áudio para: {texto!r}")
    destino.write_bytes(bytes(mp3))


def duracao(path: Path) -> float:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return float(out)


def tem_audio(path: Path) -> bool:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return bool(out)


def _rate_str(pct: int) -> str:
    return f"{pct:+d}%"


async def gerar_falas(cues: list[Cue], voz: str, rate_base: int, passo: int, max_boost: int,
                      janelas: list[float] | None, pasta: Path) -> list[tuple[Path, float, int]]:
    """Sintetiza cada cue; sobe o rate quando a fala estoura a janela."""
    falas: list[tuple[Path, float, int]] = []
    for i, cue in enumerate(cues):
        rate = rate_base
        while True:
            arq = pasta / f"cue{cue.idx:02d}_{rate:+d}.mp3"
            await sintetizar(cue.text, voz, _rate_str(rate), arq)
            dur = duracao(arq)
            janela = janelas[i] if janelas else None
            if janela is None or dur <= janela or rate >= rate_base + max_boost:
                break
            rate += passo
        falas.append((arq, dur, rate))
    return falas


def medir(cues: list[Cue], voz: str, rate: int) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        falas = asyncio.run(gerar_falas(cues, voz, rate, 0, 0, None, Path(tmp)))
    saida = [{"idx": c.idx, "texto": c.text, "duracao": round(d, 2)} for c, (_, d, _) in zip(cues, falas)]
    print(json.dumps(saida, ensure_ascii=False, indent=1))


def narrar(video: Path, legendas: Path, saida: Path, voz: str, rate: int, passo: int,
           max_boost: int, folga: float, ganho_fundo: float, aparar_inicio: float | None) -> None:
    cues = ler_cues(legendas)
    if not cues or cues[0].end == 0.0:
        sys.exit("o arquivo de legendas precisa ser um SRT com tempos")
    dur_video = duracao(video)
    corte = 0.0
    if aparar_inicio is not None:
        corte = max(0.0, cues[0].start - aparar_inicio)
        for c in cues:
            c.start -= corte
            c.end -= corte
        dur_video -= corte
        print(f"aparando {corte:.2f}s do início", file=sys.stderr)
    # janela de cada fala: do início da sua legenda até o início da seguinte
    janelas = [
        (cues[i + 1].start if i + 1 < len(cues) else dur_video) - c.start - folga
        for i, c in enumerate(cues)
    ]
    with tempfile.TemporaryDirectory() as tmp:
        pasta = Path(tmp)
        falas = asyncio.run(gerar_falas(cues, voz, rate, passo, max_boost, janelas, pasta))

        # posiciona: começa no início da legenda, ou depois da fala anterior
        inicios: list[float] = []
        fim_anterior = 0.0
        for cue, (_, dur, r), janela in zip(cues, falas, janelas):
            inicio = max(cue.start, fim_anterior + folga if fim_anterior else 0.0)
            atraso = inicio - cue.start
            aviso = ""
            if atraso > 0.05:
                aviso = f"  ⚠ atrasada {atraso:.1f}s para não sobrepor a anterior"
            elif dur > janela + 1e-6:
                aviso = "  ⚠ fala mais longa que a janela da legenda"
            print(
                f"{cue.idx:2d}  {_fmt_tempo(inicio)}  {dur:5.2f}s  janela {janela:5.2f}s  rate {r:+d}%  {cue.text}{aviso}",
                file=sys.stderr,
            )
            inicios.append(inicio)
            fim_anterior = inicio + dur

        # legendas embutidas seguem os tempos (deslocados) usados na narração
        srt_final = pasta / "legendas.srt"
        srt_final.write_text(
            "".join(f"{c.idx}\n{_fmt_tempo(c.start)} --> {_fmt_tempo(c.end)}\n{c.text}\n\n" for c in cues),
            encoding="utf-8",
        )

        # ffmpeg: cada fala atrasada até o seu início, todas somadas numa faixa
        cmd = [FFMPEG, "-v", "error", "-y"]
        if corte > 0:
            cmd += ["-ss", f"{corte:.3f}"]
        cmd += ["-i", str(video)]
        for arq, _, _ in falas:
            cmd += ["-i", str(arq)]
        n = len(falas)
        partes = []
        for k, inicio in enumerate(inicios):
            ms = int(round(inicio * 1000))
            partes.append(f"[{k + 1}:a]aresample=48000,adelay={ms}:all=1[f{k}]")
        entradas = "".join(f"[f{k}]" for k in range(n))
        partes.append(f"{entradas}amix=inputs={n}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11[nar]")
        if tem_audio(video):
            # áudio original abaixado sob a fala (compressor com sidechain)
            partes.append("[nar]asplit=2[nar1][nar2]")
            partes.append(
                f"[0:a]aresample=48000,volume={ganho_fundo}[fundo];"
                "[fundo][nar2]sidechaincompress=threshold=0.03:ratio=8:attack=40:release=500[duck]"
            )
            partes.append("[duck][nar1]amix=inputs=2:normalize=0:dropout_transition=0,apad[out]")
        else:
            partes.append("[nar]apad[out]")
        # com corte o vídeo é recodificado (corte exato); sem corte é copiado
        codec_video = ["-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p"] if corte > 0 else ["-c:v", "copy"]
        cmd += [
            "-i", str(srt_final),
            "-filter_complex", ";".join(partes),
            "-map", "0:v", "-map", "[out]", "-map", f"{n + 1}:s",
            *codec_video, "-c:a", "aac", "-b:a", "128k", "-c:s", "mov_text",
            "-metadata:s:s:0", "language=por", "-shortest", "-movflags", "+faststart",
            str(saida),
        ]
        subprocess.run(cmd, check=True)
    print(f"ok: {saida}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", nargs="?", type=Path)
    ap.add_argument("legendas", nargs="?", type=Path)
    ap.add_argument("-o", "--saida", type=Path)
    ap.add_argument("--voz", default=VOZ_PADRAO)
    ap.add_argument("--rate", type=int, default=0, help="rate base do edge-tts em %% (padrão 0)")
    ap.add_argument("--passo", type=int, default=10, help="incremento de rate quando a fala não cabe")
    ap.add_argument("--max-boost", type=int, default=30, help="máximo acima do rate base")
    ap.add_argument("--folga", type=float, default=0.35, help="silêncio mínimo entre falas (s)")
    ap.add_argument("--ganho-fundo", type=float, default=0.5, help="volume do áudio original sob a fala")
    ap.add_argument("--aparar-inicio", type=float, metavar="S",
                    help="corta o começo deixando S segundos antes da primeira legenda")
    ap.add_argument("--medir", type=Path, help="só sintetiza e imprime a duração de cada fala (JSON)")
    a = ap.parse_args()
    if a.medir:
        medir(ler_cues(a.medir), a.voz, a.rate)
        return
    if not (a.video and a.legendas):
        ap.error("informe VIDEO e LEGENDAS.srt (ou --medir)")
    saida = a.saida or a.video.with_name(a.video.stem + "-narrado.mp4")
    narrar(a.video, a.legendas, saida, a.voz, a.rate, a.passo, a.max_boost, a.folga, a.ganho_fundo, a.aparar_inicio)


if __name__ == "__main__":
    main()
