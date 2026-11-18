#!/bin/sh
# แปลงวิดีโอของ TC ระดับ P1 เป็น GIF (1 ไฟล์ต่อ TC · หลายหน้าในบท TC เดียวต่อกันตามลำดับเวลา)
# ใช้หลัง: REPORT=1 npx playwright test   (วิดีโออยู่ที่ ../test-report/.artifacts)
# ต้องมี ffmpeg ใน PATH
set -eu
cd "$(dirname "$0")/.."
ART=../test-report/.artifacts
OUT=../test-report/gif
FPS=4
WIDTH=640
P1="AUTH-01 AUTH-02 AUTH-03 FEE-01 SUBMIT-01 SUBMIT-02 UPLOAD-01 UPLOAD-02 PAY-01 PAY-02 PAY-03 QUEUE-01 QUEUE-02 QUEUE-03
SLA-01 SLA-02 SLA-03 NOTI-01 NOTI-02 WORKFLOW-01 WORKFLOW-02 WORKFLOW-03 WORKFLOW-04 WORKFLOW-05 WORKFLOW-06
DOC-01 DOC-02 DOC-03 PDPA-01 PDPA-02 PDPA-03 DASH-01 DASH-02 DASH-04 AUDIT-01 AUDIT-02 AUDIT-03
RBAC-01 RBAC-02 RBAC-03 RBAC-05 NFR-01 NFR-02"

mkdir -p "$OUT"
: > "$OUT/INDEX.txt"
for tc in $P1; do
  dir=$(find "$ART" -maxdepth 1 -type d -name "*-TC-$tc-*" | head -1)
  vids=""
  [ -n "$dir" ] && vids=$(ls -tr "$dir"/*.webm 2>/dev/null || true)
  if [ -z "$vids" ]; then
    echo "TC-$tc	(ไม่มีวิดีโอ: TC ตรวจผ่าน API อย่างเดียว ไม่เปิดหน้าเว็บ)" >> "$OUT/INDEX.txt"
    continue
  fi
  list="$OUT/.concat.txt"
  for v in $vids; do printf "file '%s'\n" "$(cd "$(dirname "$v")" && (pwd -W 2>/dev/null || pwd))/$(basename "$v")" >> "$list"; done
  ffmpeg -loglevel error -y -f concat -safe 0 -i "$list" \
    -vf "fps=$FPS,scale=$WIDTH:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer" \
    "$OUT/TC-$tc.gif"
  rm -f "$list"
  echo "TC-$tc	gif/TC-$tc.gif	$(echo "$vids" | wc -l) หน้า" >> "$OUT/INDEX.txt"
done
cat "$OUT/INDEX.txt"
