#!/bin/zsh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$PROJECT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/piano-score-coach.pid"
SERVER_PID_FILE="$RUNTIME_DIR/piano-score-coach.server.pid"
HEARTBEAT_FILE="$RUNTIME_DIR/piano-score-coach.heartbeat"
LOG_FILE="$RUNTIME_DIR/piano-score-coach.log"
SUPERVISOR_SCRIPT="$PROJECT_DIR/scripts/piano-coach-supervisor.mjs"
PORT="${PIANO_COACH_PORT:-3000}"
URL="http://127.0.0.1:${PORT}"
LIFECYCLE_URL="$URL/api/lifecycle/heartbeat"
IDLE_TIMEOUT_SECONDS="${PIANO_COACH_IDLE_TIMEOUT_SECONDS:-900}"
SUPERVISOR_PID=""

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

is_service_running() {
  curl -fsS "$LIFECYCLE_URL" 2>/dev/null \
    | grep -q '"service"[[:space:]]*:[[:space:]]*"piano-score-coach"'
}

remove_runtime_state_for_pid() {
  local expected_pid="$1"
  local recorded_pid=""

  if [[ -f "$PID_FILE" ]]; then
    recorded_pid="$(cat "$PID_FILE")"
  fi

  if [[ "$recorded_pid" == "$expected_pid" ]]; then
    rm -f "$PID_FILE" "$SERVER_PID_FILE" "$HEARTBEAT_FILE"
  fi
}

cleanup_started_supervisor() {
  if [[ -z "$SUPERVISOR_PID" ]]; then
    return 0
  fi

  if is_our_supervisor "$SUPERVISOR_PID"; then
    kill "$SUPERVISOR_PID" 2>/dev/null || true

    for _ in {1..12}; do
      if ! kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
        break
      fi

      sleep 1
    done

    if kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
      kill -9 "$SUPERVISOR_PID" 2>/dev/null || true
    fi
  fi

  remove_runtime_state_for_pid "$SUPERVISOR_PID"
}

handle_exit() {
  local exit_code="$?"

  if [[ "$exit_code" -ne 0 ]]; then
    cleanup_started_supervisor
    echo
    echo "启动失败。"
    echo "可以查看日志：$LOG_FILE"
    read "?按回车关闭窗口..."
  fi

  exit "$exit_code"
}

trap handle_exit EXIT

if [[ -f "$HOME/.zprofile" ]]; then
  source "$HOME/.zprofile"
fi

if [[ -f "$HOME/.zshrc" ]]; then
  source "$HOME/.zshrc"
fi

cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1; then
  echo "没有找到 Node.js 或 pnpm。请先安装后再启动。"
  exit 1
fi

mkdir -p "$RUNTIME_DIR"

if is_service_running; then
  echo "陪练已经在运行：$URL"
  open "$URL" >/dev/null 2>&1 || true
  trap - EXIT
  exit 0
fi

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"

  if is_our_supervisor "$EXISTING_PID"; then
    echo "陪练正在启动，请稍候…"

    for _ in {1..40}; do
      if is_service_running; then
        echo "已经启动成功：$URL"
        open "$URL" >/dev/null 2>&1 || true
        trap - EXIT
        exit 0
      fi

      if ! kill -0 "$EXISTING_PID" 2>/dev/null; then
        break
      fi

      sleep 1
    done

    echo "已有启动进程没有正常响应，请先运行“关闭陪练.command”后重试。"
    exit 1
  fi

  rm -f "$PID_FILE" "$SERVER_PID_FILE" "$HEARTBEAT_FILE"
fi

PORT_PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"

if [[ -n "$PORT_PID" ]]; then
  echo "无法启动：$PORT 端口正被其他程序占用。"
  echo "为了避免误关其他程序，陪练没有接管这个端口。"
  exit 1
fi

echo "正在启动陪练服务..."
PIANO_COACH_PROJECT_DIR="$PROJECT_DIR" \
PIANO_COACH_RUNTIME_DIR="$RUNTIME_DIR" \
PIANO_COACH_PORT="$PORT" \
PIANO_COACH_IDLE_TIMEOUT_SECONDS="$IDLE_TIMEOUT_SECONDS" \
nohup node "$SUPERVISOR_SCRIPT" > "$LOG_FILE" 2>&1 &
SUPERVISOR_PID="$!"
echo "$SUPERVISOR_PID" > "$PID_FILE"

for _ in {1..40}; do
  if is_service_running; then
    echo "已经启动成功：$URL"
    echo "日志位置：$LOG_FILE"
    open "$URL" >/dev/null 2>&1 || true
    trap - EXIT
    exit 0
  fi

  if ! kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
    echo "陪练后台服务提前退出。"
    exit 1
  fi

  sleep 1
done

echo "服务启动超时。"
exit 1
