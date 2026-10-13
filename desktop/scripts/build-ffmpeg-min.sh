#!/usr/bin/env bash
# Compila un ffmpeg MÍNIMO y solo LGPL para el puente de video de la garita (T6/T7).
#
#   desktop/scripts/build-ffmpeg-min.sh windows   # ffmpeg.exe (x86_64-w64-mingw32), cruzado desde Linux
#   desktop/scripts/build-ffmpeg-min.sh linux     # ffmpeg nativo (para probar en Linux)
#
# Salida: desktop/src-tauri/binaries/ffmpeg-<triple>[.exe]  (el nombre que Tauri espera de un `externalBin`).
#
# Por qué no el ffmpeg de siempre: el build estático popular para Windows (BtbN/gyan/ffmpeg-static) es GPLv3, pesa ~83 MB y trae
# cientos de códecs que no se usan. Este solo hace RTSP (H.264 / H.265 / MJPEG) → fotogramas JPEG: ~3,4 MB y LGPL 2.1+ (sin x264/x265).
# Medido el 11/10/2026: ver docs/camaras_ip_diseno.md.
#
# Requisitos (Ubuntu): build-essential nasm yasm make curl xz-utils  (+ gcc-mingw-w64-x86-64 para `windows`).
# Cumplimiento LGPL: el binario se distribuye como programa APARTE (no se enlaza con la app) y se puede reemplazar por otro;
# hay que publicar este script, la versión y el SHA-256 del código fuente, y el texto de la licencia (COPYING.LGPLv2.1 viene en el tarball).
set -euo pipefail

OBJETIVO="${1:-windows}"
FFMPEG_VERSION="6.1.1"
FFMPEG_SHA256="8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SALIDA="$RAIZ/src-tauri/binaries"
TRABAJO="${FFMPEG_TRABAJO:-$(mktemp -d)}/$OBJETIVO"     # una carpeta por destino: un árbol configurado para Linux no sirve para Windows
mkdir -p "$TRABAJO"

case "$OBJETIVO" in
  windows) TRIPLE="x86_64-pc-windows-msvc"; EXT=".exe"
           CRUZADO=(--enable-cross-compile --arch=x86_64 --target-os=mingw32 --cross-prefix=x86_64-w64-mingw32-) ;;
  linux)   TRIPLE="x86_64-unknown-linux-gnu"; EXT=""; CRUZADO=() ;;
  *) echo "uso: $0 windows|linux" >&2; exit 2 ;;
esac

echo "▶ ffmpeg $FFMPEG_VERSION mínimo LGPL para $OBJETIVO (en $TRABAJO)"
curl -fsSL -o "$TRABAJO/ffmpeg.tar.xz" "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
echo "$FFMPEG_SHA256  $TRABAJO/ffmpeg.tar.xz" | sha256sum -c -
tar -xf "$TRABAJO/ffmpeg.tar.xz" -C "$TRABAJO"
cd "$TRABAJO/ffmpeg-$FFMPEG_VERSION"

# Solo lo necesario: RTSP sobre TCP, decodificar H.264/H.265/MJPEG, escalar, reducir fotogramas y codificar MJPEG.
./configure "${CRUZADO[@]}" \
  --disable-gpl --disable-nonfree --disable-version3 --disable-everything --disable-autodetect --disable-doc --disable-debug \
  --disable-ffplay --disable-ffprobe --enable-small --enable-ffmpeg \
  --enable-avcodec --enable-avformat --enable-avfilter --enable-swscale --disable-swresample --disable-avdevice --disable-postproc \
  --enable-network --enable-protocol=tcp,udp,rtp,http,file,pipe,crypto \
  --enable-demuxer=rtsp,rtp,sdp,mjpeg,mpjpeg,image2,h264,hevc --enable-parser=h264,hevc,mjpeg \
  --enable-decoder=h264,hevc,mjpeg,rawvideo --enable-encoder=mjpeg --enable-muxer=mpjpeg,image2,mjpeg \
  --enable-filter=scale,fps,format,null,crop,transpose --enable-bsf=h264_mp4toannexb,hevc_mp4toannexb,extract_extradata \
  --enable-static --disable-shared
make -j"$(nproc)" ffmpeg"$EXT"

mkdir -p "$SALIDA"
install -m 755 "ffmpeg$EXT" "$SALIDA/ffmpeg-$TRIPLE$EXT"
cp COPYING.LGPLv2.1 "$SALIDA/ffmpeg-LICENSE.txt"
echo "✓ $SALIDA/ffmpeg-$TRIPLE$EXT  ($(du -h "$SALIDA/ffmpeg-$TRIPLE$EXT" | cut -f1))"
