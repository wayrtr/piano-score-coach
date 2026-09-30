#!/bin/zsh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$PROJECT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/piano-score-coach.pid"
SERVER_PID_FILE="$RUNTIME_DIR/piano-score-coach.server.pid"
HEARTBEAT_FILE="$RUNTIME_DIR/piano-score-coach.heartbeat"
SUPERVISOR_SCRIPT="$PROJECT_DIR/scripts/piano-coach-supervisor.mjs"
PORT="${PIANO_COACH_PORT:-3000}"
URL="http://127.0.0.1:${PORT}"

is_numeric_pid() {
  local pid="$1"

  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
  esac

  [[ "$pid" -gt 1 ]]
}

is_our_supervisor() {
  local pid="$1"
  local command_line

  if ! is_numeric_pid "$pid" || ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi

  command_line="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command_line" == *"$SUPERVISOR_SCRIPT"* ]]
}

handle_exit() {
  local exit_code="$?"

  if [[ "$exit_code" -ne 0 ]]; then
    echo
    echo "关闭失败。"
    read "?按回车关闭窗口..."
  fi

  exit "$exit_code"
}

trap handle_exit EXIT

stop_pid() {
  local pid="$1"

  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  kill "$pid" 2>/dev/null || true

  for _ in {1..10}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi

    sleep 1
  done

  kill -9 "$pid" 2>/dev/null || true
}

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"

  if is_our_supervisor "$PID"; then
    stop_pid "$PID"
    rm -f "$PID_FILE" "$SERVER_PID_FILE" "$HEARTBEAT_FILE"
    echo "陪练服务已经关闭。"
    trap - EXIT
    exit 0
  fi

  rm -f "$PID_FILE" "$SERVER_PID_FILE" "$HEARTBEAT_FILE"
fi

echo "没有找到可安全关闭的陪练管理进程。"
trap - EXIT
exit 0
