#!/usr/bin/env bash
# Sync .claude/commands/*.md -> .codex/prompts/*.md (+ optional install to ~/.codex/prompts)
# Usage: scripts/sync-codex-prompts.sh [--install]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/.claude/commands"
OUT_DIR="$ROOT/.codex/prompts"
INSTALL_DIR="${CODEX_HOME:-$HOME/.codex}/prompts"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "error: not found: $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
# remove stale prompts whose source command was deleted
for out in "$OUT_DIR"/*.md; do
  [[ -e "$out" ]] || continue
  [[ -e "$SRC_DIR/$(basename "$out")" ]] || { rm -f "$out"; echo "removed  $(basename "$out")"; }
done

count=0
for src in "$SRC_DIR"/*.md; do
  name="$(basename "$src")"
  note="> Codex: ไฟล์นี้สร้างจาก \`.claude/commands/$name\` (อย่าแก้ตรงนี้ — แก้ต้นฉบับแล้วรัน \`scripts/sync-codex-prompts.sh\`) — ทำตามกติกาแปลงใน \`AGENTS.md\` หัวข้อ 0 (\"โหลด skill \`X\`\" = อ่าน \`.claude/skills/X/SKILL.md\` ทั้งไฟล์ก่อนลงมือ · \"ถามผู้ใช้\" = หยุดรอคำตอบ) และจบงานด้วย Completion report format ใน \`AGENTS.md\`"
  awk -v note="$note" '
    BEGIN { fm = 0; done = 0 }
    NR == 1 && $0 != "---" { print note; print ""; done = 1 }
    /^---\r?$/ && fm < 2 && !done { fm++; print; if (fm == 2) { print ""; print note; print ""; done = 1 }; next }
    { print }
  ' "$src" > "$OUT_DIR/$name"
  count=$((count + 1))
done
echo "synced   $count prompt(s) -> $OUT_DIR"

if [[ "${1:-}" == "--install" ]]; then
  mkdir -p "$INSTALL_DIR"
  cp "$OUT_DIR"/*.md "$INSTALL_DIR"/
  echo "installed -> $INSTALL_DIR (เรียกใช้: /prompts:<name>)"
fi
