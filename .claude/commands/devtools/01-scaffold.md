---
description: สร้างไฟล์ build ของ devtools container ตั้งแต่ศูนย์ (Dockerfile, start.sh, jupyter_overrides.json, .dockerignore)
argument-hint: "[โฟลเดอร์ปลายทาง — ค่าเริ่มต้น ./devtools]"
---

สร้างชุดไฟล์สำหรับ build image `ai-vibecoding-devtools:week2` จากศูนย์ ห้ามไปอ่านหรือคัดลอกจากโฟลเดอร์อื่น (เช่น `00_Devtool_Container`) ให้ใช้เนื้อหาที่ฝังไว้ในคำสั่งนี้เท่านั้น

โฟลเดอร์ปลายทาง: `$ARGUMENTS` (ถ้าว่างให้ใช้ `./devtools` นับจาก root ของโปรเจกต์)

## ขั้นตอน

1. ถ้าโฟลเดอร์ปลายทางมีไฟล์ชื่อเดียวกันอยู่แล้ว ให้แสดงรายการแล้วถามผู้ใช้ก่อนเขียนทับ
2. สร้างโฟลเดอร์ปลายทาง พร้อมโฟลเดอร์ย่อยว่าง `workspace/` และ `Devtool_SSH/` (start.sh จะสร้าง SSH key ลง `Devtool_SSH/` เองตอน container เริ่มครั้งแรก)
3. เขียน 4 ไฟล์ด้านล่างด้วย Write tool ตามเนื้อหาทุกตัวอักษร
4. **สำคัญ:** ทุกไฟล์ต้องลงท้ายบรรทัดแบบ LF ไม่ใช่ CRLF บน Windows ให้ตรวจด้วย `file <ไฟล์>` ถ้ายังเห็น `CRLF` ให้รัน `sed -i 's/\r$//' <ไฟล์>` (ถ้า start.sh เป็น CRLF container จะดับทันทีพร้อม error `exec /usr/local/bin/start.sh: no such file or directory`)
5. สรุปรายการไฟล์ที่สร้าง แล้วแนะนำให้รัน `/02-build` ต่อ

## ไฟล์ `Dockerfile`

```dockerfile
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Bangkok \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        gnupg \
        lsb-release \
        software-properties-common \
        sudo \
        vim \
        nano \
        less \
        net-tools \
        iputils-ping \
        dnsutils \
        git \
        openssh-server \
        tzdata \
        python3 \
        python3-pip \
        python3-venv \
        python-is-python3 \
 && ln -fs "/usr/share/zoneinfo/${TZ}" /etc/localtime \
 && dpkg-reconfigure -f noninteractive tzdata \
 && rm -rf /var/lib/apt/lists/*

# Git ล่าสุดจาก git-core PPA (git worktree ต้องใช้ git >= 2.5; Ubuntu 24.04 มี 2.43 อยู่แล้ว
# แต่ติดตั้งเวอร์ชันล่าสุดไว้เพื่อให้ได้ฟีเจอร์ worktree ครบทุกคำสั่ง เช่น repair/move)
RUN add-apt-repository -y ppa:git-core/ppa \
 && apt-get update && apt-get install -y --no-install-recommends git \
 && git --version \
 && git init -q /tmp/worktree-check \
 && git -C /tmp/worktree-check worktree list >/dev/null \
 && rm -rf /tmp/worktree-check /var/lib/apt/lists/*

RUN install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

# Node.js (LTS 22.x) สำหรับ run Next.js / React / Vite
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g npm@latest \
 && rm -rf /var/lib/apt/lists/*

# AI coding CLI: Claude Code (native installer -> /root/.local/bin) + OpenAI Codex (npm)
# symlink claude ไปไว้ /usr/local/bin เพื่อให้ทุก shell (JupyterLab terminal, SSH, docker exec) เห็นคำสั่ง
RUN curl -fsSL https://claude.ai/install.sh | bash \
 && ln -sf /root/.local/bin/claude /usr/local/bin/claude \
 && npm install -g @openai/codex \
 && claude --version \
 && codex --version

RUN install -d /workspace

# ------------------------------------------------------------------
# JupyterLab + extensions (ติดตั้งลง system python เพื่อให้ kernel เห็น
# package เดียวกับที่ใช้ใน terminal / SSH)
#   - jupytext                : เปิด .py / .md เป็น notebook ได้ (pair notebook <-> script)
#   - jupyterlab-git          : Git UI ใน sidebar
#   - jupyterlab-lsp          : autocomplete / hover / diagnostics (python-lsp-server)
#   - jupyterlab-code-formatter + black + isort : จัดรูปแบบโค้ด
#   - jupyterlab-execute-time : แสดงเวลารันของแต่ละ cell
#   - jupyter-resource-usage  : แสดง CPU / RAM ใน status bar
#   - ipywidgets              : interactive widgets
#   - bash_kernel             : เขียน notebook ด้วย Bash kernel (เหมาะกับ DevTools lab)
# ------------------------------------------------------------------
ENV PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_ROOT_USER_ACTION=ignore

RUN pip install \
        "jupyterlab>=4.3,<5" \
        notebook \
        ipywidgets \
        jupytext \
        jupyterlab-git \
        jupyterlab-lsp \
        "python-lsp-server[all]" \
        jupyterlab-code-formatter \
        black \
        isort \
        jupyterlab-execute-time \
        jupyter-resource-usage \
        bash_kernel \
 && python -m bash_kernel.install --sys-prefix \
 && jupyter lab --version \
 && jupyter labextension list 2>&1 | grep -E 'enabled|OK' | head -20

# Jupyter Server config (system-wide)
RUN mkdir -p /etc/jupyter \
 && cat > /etc/jupyter/jupyter_server_config.py <<'EOF'
c = get_config()  # noqa

c.ServerApp.ip = "0.0.0.0"
c.ServerApp.port = 8888
c.ServerApp.root_dir = "/"          # เห็นทั้ง filesystem (โฟลเดอร์งานอยู่ที่ /workspace)
c.ServerApp.allow_root = True
c.ServerApp.open_browser = False
c.ServerApp.allow_remote_access = True

# แสดง hidden file / folder (ชื่อขึ้นต้นด้วย ".") ใน file browser เช่น .env .git .gitignore
# (ฝั่ง UI ตั้ง showHiddenFiles ไว้ใน overrides.json; ต้องเปิดทั้งสองฝั่งจึงจะเห็น)
c.ContentsManager.allow_hidden = True

# terminal ใน JupyterLab ใช้ bash login shell (อ่าน /etc/profile, ~/.bashrc)
c.ServerApp.terminals_enabled = True
c.ServerApp.terminado_settings = {"shell_command": ["/bin/bash", "-l"]}

# ไม่ใช้ token; รหัสผ่าน (ถ้ามี) ถูกตั้งจาก start.sh ผ่าน $JUPYTER_PASSWORD (default: ไม่มีรหัสผ่าน)
c.IdentityProvider.token = ""
c.PasswordIdentityProvider.allow_password_change = False
EOF

# JupyterLab UI defaults — file browser แสดง hidden file/folder และ terminal ให้ copy/paste ได้สะดวก:
#   * Ctrl+V           = paste (pasteWithCtrlV)
#   * Ctrl+Shift+C / V = copy / paste
#   * Ctrl+Insert / Shift+Insert = copy / paste
#   * คลิกขวาที่ terminal จะมีเมนู Copy / Paste
COPY jupyter_overrides.json /usr/local/share/jupyter/lab/settings/overrides.json

# ตั้งรหัสผ่าน root = passwd และเปิดให้ login ผ่าน SSH ได้ทั้ง password และ key
#   - password : ssh root@localhost -p 2222            (password: passwd)
#   - key      : ssh -i ssh/devtoolSSH root@localhost -p 2222
#     start.sh จะนำ public key จาก /etc/devtools/ssh/devtoolSSH.pub (mount มาจาก ./ssh บน host)
#     ไปใส่ใน /root/.ssh/authorized_keys ทุกครั้งที่ container start
RUN echo 'root:passwd' | chpasswd \
 && mkdir -p /etc/ssh/sshd_config.d /etc/devtools/ssh \
 && install -d -m 700 /root/.ssh \
 && printf 'PermitRootLogin yes\nPasswordAuthentication yes\nPubkeyAuthentication yes\n' \
      > /etc/ssh/sshd_config.d/10-root-login.conf

# start script: sshd + dockerd + jupyter lab (ไม่มีรหัสผ่าน เว้นแต่ตั้ง $JUPYTER_PASSWORD)
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

VOLUME /var/lib/docker

# 22=ssh, 8888=jupyterlab
EXPOSE 22 8888

WORKDIR /workspace

CMD ["/usr/local/bin/start.sh"]
```

## ไฟล์ `start.sh`

```bash
#!/bin/bash
# start.sh — entrypoint ของ devtools container
#   1) sshd        (port 22)   : root / passwd หรือ key devtoolSSH (map ./Devtool_SSH มา)
#   2) dockerd     (Docker-in-Docker, ต้อง --privileged)
#   3) jupyter lab (port 8888) : ไม่มีรหัสผ่าน (ตั้งได้ด้วย $JUPYTER_PASSWORD)
# ถ้ารันแบบมี tty (-it) จะเปิด bash ให้; ถ้ารันแบบ -d จะ tail log แทนเพื่อให้ container ไม่ดับ

mkdir -p /run/sshd
ssh-keygen -A >/dev/null 2>&1

# --- SSH key login ------------------------------------------------------------
# โฟลเดอร์ key = /etc/devtools/ssh (map volume มาจาก ./Devtool_SSH บน host)
#   - มี devtoolSSH + devtoolSSH.pub อยู่แล้ว (key สำเร็จรูปของ lab) → ใช้คู่นั้น
#   - ยังไม่มี → สร้างคู่ใหม่ลงโฟลเดอร์นั้นเลย นศ. หยิบ private key จาก host ไปใช้ได้ทันที
# public key ถูก copy เข้า /root/.ssh/authorized_keys (ไม่ mount ตรง เพราะ sshd ต้องการ
# owner=root และ permission 600 — bind mount จาก Windows จะเป็น 777 ทำให้ sshd ปฏิเสธ key)
SSH_KEY_DIR="${SSH_KEY_DIR:-/etc/devtools/ssh}"
SSH_KEY="$SSH_KEY_DIR/devtoolSSH"
install -d -m 700 /root/.ssh
touch /root/.ssh/authorized_keys
mkdir -p "$SSH_KEY_DIR" 2>/dev/null
if [ ! -s "$SSH_KEY.pub" ] && [ -w "$SSH_KEY_DIR" ]; then
    rm -f "$SSH_KEY" "$SSH_KEY.pub"
    ssh-keygen -q -t ed25519 -f "$SSH_KEY" -N "" -C devtools-lab
    # ให้ไฟล์เป็นของ user เจ้าของโฟลเดอร์บน host (Linux host ที่ไม่ใช่ root จะได้อ่าน key ได้)
    chown "$(stat -c %u:%g "$SSH_KEY_DIR")" "$SSH_KEY" "$SSH_KEY.pub" 2>/dev/null
    echo "[start.sh] generated new SSH key pair: $SSH_KEY{,.pub}"
fi
if [ -s "$SSH_KEY.pub" ]; then
    KEY_LINE="$(tr -d '\r' < "$SSH_KEY.pub" | head -n1)"
    grep -qxF "$KEY_LINE" /root/.ssh/authorized_keys || echo "$KEY_LINE" >> /root/.ssh/authorized_keys
    echo "[start.sh] SSH key login enabled: $SSH_KEY.pub"
else
    echo "[start.sh] no $SSH_KEY.pub — SSH key login disabled (password login still works)"
fi
chmod 600 /root/.ssh/authorized_keys
chown -R root:root /root/.ssh

/usr/sbin/sshd

# docker restart / docker start ทิ้ง pid file เก่าไว้ → dockerd ไม่ยอม start ("process with PID xx is still running")
rm -f /var/run/docker.pid /var/run/docker/containerd/containerd.pid
dockerd > /var/log/dockerd.log 2>&1 &

# --- JupyterLab -------------------------------------------------------------
# ค่าเริ่มต้น: ไม่มีรหัสผ่าน (เปิด http://localhost:8888 ได้เลย)
# ถ้าต้องการรหัสผ่านให้รันด้วย -e JUPYTER_PASSWORD=xxx (hash เก็บในไฟล์ config ไม่โชว์บน ps)
export JUPYTER_PASSWORD="${JUPYTER_PASSWORD:-}"
mkdir -p /root/.jupyter
python3 - <<'PY'
import json, os
from jupyter_server.auth import passwd
pw = os.environ.get("JUPYTER_PASSWORD", "")
cfg = {"PasswordIdentityProvider": {"hashed_password": passwd(pw) if pw else ""}}
with open("/root/.jupyter/jupyter_server_config.json", "w") as f:
    json.dump(cfg, f, indent=2)
PY

# หมายเหตุ: คำสั่งที่ bash script รันแบบ background (&) จะถูกตั้ง SIGINT/SIGQUIT = ignore
# และสืบทอดไปยัง terminal ใน JupyterLab ทำให้ Ctrl+C หยุดโปรเซสไม่ได้
# จึง reset signal กลับเป็น default ก่อน exec jupyter
cd /workspace
python3 -c '
import os, signal
signal.signal(signal.SIGINT, signal.SIG_DFL)
signal.signal(signal.SIGQUIT, signal.SIG_DFL)
os.execvp("jupyter", ["jupyter", "lab"])
' > /var/log/jupyter.log 2>&1 &

echo "[start.sh] sshd :22 | dockerd | jupyter lab :8888 (password: ${JUPYTER_PASSWORD:-<none>}) — logs: /var/log/jupyter.log /var/log/dockerd.log"

if [ -t 0 ]; then
    exec bash
else
    exec tail -F /var/log/jupyter.log
fi
```

## ไฟล์ `jupyter_overrides.json`

```json
{
  "@jupyterlab/filebrowser-extension:browser": {
    "showHiddenFiles": true
  },
  "@jupyterlab/terminal-extension:plugin": {
    "pasteWithCtrlV": true,
    "scrollback": 10000,
    "cursorBlink": true,
    "fontSize": 13,
    "shutdownOnClose": false,
    "closeOnExit": true
  },
  "@jupyterlab/shortcuts-extension:shortcuts": {
    "shortcuts": [
      {
        "command": "terminal:copy",
        "keys": [
          "Ctrl Shift C"
        ],
        "selector": ".jp-Terminal"
      },
      {
        "command": "terminal:paste",
        "keys": [
          "Ctrl Shift V"
        ],
        "selector": ".jp-Terminal"
      },
      {
        "command": "terminal:copy",
        "keys": [
          "Ctrl Insert"
        ],
        "selector": ".jp-Terminal"
      },
      {
        "command": "terminal:paste",
        "keys": [
          "Shift Insert"
        ],
        "selector": ".jp-Terminal"
      }
    ]
  },
  "@jupyterlab/apputils-extension:notification": {
    "checkForUpdates": false,
    "fetchNews": "false"
  },
  "@jupyterlab/notebook-extension:tracker": {
    "recordTiming": true
  },
  "@jupyterlab/fileeditor-extension:plugin": {
    "editorConfig": {
      "lineNumbers": true
    }
  }
}
```

## ไฟล์ `.dockerignore`

```
.ipynb_checkpoints
untitled.txt
readme.md
docker-compose.yml
workspace
Devtool_SSH
```
