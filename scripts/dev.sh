#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dev.sh — Start the web app and Python worker side-by-side.
#
# Requires:
#   - tmux (for split-pane mode) OR two terminal windows
#
# Usage:
#   ./scripts/dev.sh          # starts both in tmux (if available)
#   ./scripts/dev.sh --web    # start web only
#   ./scripts/dev.sh --worker # start worker only
# ─────────────────────────────────────────────────────────────────────────────

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

start_web() {
  echo "Starting Next.js dev server..."
  cd "$ROOT/web"
  npm run dev
}

start_worker() {
  echo "Starting Python worker..."
  cd "$ROOT/worker"
  if [ -d ".venv" ]; then
    source .venv/bin/activate 2>/dev/null || source .venv/Scripts/activate 2>/dev/null
  fi
  python worker.py
}

if [[ "$1" == "--web" ]]; then
  start_web
elif [[ "$1" == "--worker" ]]; then
  start_worker
elif command -v tmux &>/dev/null; then
  echo "Starting both services in tmux session 'labelpilot'..."
  tmux new-session -d -s labelpilot -x 220 -y 50 2>/dev/null || true
  tmux split-window -h -t labelpilot
  tmux send-keys -t labelpilot:0.0 "cd '$ROOT' && bash scripts/dev.sh --web" Enter
  tmux send-keys -t labelpilot:0.1 "cd '$ROOT' && bash scripts/dev.sh --worker" Enter
  tmux attach -t labelpilot
else
  echo "tmux not found. Open two terminals and run:"
  echo "  Terminal 1: cd web && npm run dev"
  echo "  Terminal 2: cd worker && python worker.py"
fi
