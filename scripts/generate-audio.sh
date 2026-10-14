#!/usr/bin/env bash
# Generates SYNTHETIC consultation audio from demo/scripts/*.txt with Amazon Polly.
# Output per script (demo/audio/):
#   <name>.wav  16 kHz, 16-bit PCM, STEREO: clinician on the left channel,
#               patient on the right. Used for HealthScribe ChannelIdentification.
#   <name>.mp3  for playback.
# Script format: "DOCTOR: ..." / "PATIENT: ..." lines, plus a
# "# voices: DOCTOR=<PollyVoice> PATIENT=<PollyVoice>" header line.
#   scripts/generate-audio.sh            # all scripts
#   scripts/generate-audio.sh consult-pt001
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-paul-padarhealth}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
ENGINE="${POLLY_ENGINE:-generative}"
GAP_SECONDS="${GAP_SECONDS:-0.45}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS_DIR="$ROOT/demo/scripts"
OUT_DIR="$ROOT/demo/audio"
mkdir -p "$OUT_DIR"

command -v ffmpeg >/dev/null || { echo "ffmpeg is required (brew install ffmpeg)"; exit 1; }

generate() {
  local name="$1" src="$SCRIPTS_DIR/$1.txt"
  local work; work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN

  local voices doctor_voice patient_voice
  voices="$(grep -m1 '^# voices:' "$src")" || { echo "$src: missing '# voices:' header"; exit 1; }
  doctor_voice="$(sed -E 's/.*DOCTOR=([A-Za-z]+).*/\1/' <<<"$voices")"
  patient_voice="$(sed -E 's/.*PATIENT=([A-Za-z]+).*/\1/' <<<"$voices")"

  local i=0 list="$work/list.txt"
  : >"$list"
  while IFS= read -r line; do
    [[ "$line" =~ ^(DOCTOR|PATIENT):[[:space:]]*(.+)$ ]] || continue
    local speaker="${BASH_REMATCH[1]}" text="${BASH_REMATCH[2]}"
    local voice pan
    if [[ "$speaker" == "DOCTOR" ]]; then
      voice="$doctor_voice"; pan="pan=stereo|c0=c0|c1=0*c0"
    else
      voice="$patient_voice"; pan="pan=stereo|c0=0*c0|c1=c0"
    fi
    i=$((i + 1))
    local seg; seg="$(printf '%03d' "$i")"

    aws polly synthesize-speech --engine "$ENGINE" --voice-id "$voice" \
      --output-format pcm --sample-rate 16000 --text "$text" "$work/$seg.pcm" >/dev/null

    ffmpeg -loglevel error -f s16le -ar 16000 -ac 1 -i "$work/$seg.pcm" \
      -af "apad=pad_dur=$GAP_SECONDS,$pan" -ar 16000 -c:a pcm_s16le "$work/$seg.wav"
    echo "file '$work/$seg.wav'" >>"$list"
  done <"$src"

  ffmpeg -loglevel error -y -f concat -safe 0 -i "$list" -c:a pcm_s16le "$OUT_DIR/$name.wav"
  ffmpeg -loglevel error -y -i "$OUT_DIR/$name.wav" -codec:a libmp3lame -b:a 96k "$OUT_DIR/$name.mp3"

  local dur; dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT_DIR/$name.wav")"
  printf '%s: %d turns, %.0f s (doctor=%s, patient=%s)\n' "$name" "$i" "$dur" "$doctor_voice" "$patient_voice"
}

if [[ $# -gt 0 ]]; then
  for n in "$@"; do generate "$n"; done
else
  for f in "$SCRIPTS_DIR"/*.txt; do generate "$(basename "$f" .txt)"; done
fi
