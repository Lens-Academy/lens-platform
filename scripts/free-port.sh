#!/bin/bash
# Kill a stale process listening on a port from a previous run of this project.
# Usage: free-port.sh <port>
# Only kills if the listener's cwd is under this project root AND it's not
# a sibling process in the current process-compose session (same PPID ancestry).

set -euo pipefail

port="${1:?usage: free-port.sh <port>}"
project_root="$(cd "$(dirname "$0")/.." && pwd)"

pid=$(ss -tlnp "sport = :$port" 2>/dev/null \
  | grep -oP 'pid=\K[0-9]+' \
  | head -1)

[ -z "$pid" ] && exit 0

proc_cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)

# Walk up our own ancestry to find the process-compose (or shell) session root.
# If the port holder shares that ancestor, it's from this session — don't kill it.
is_sibling() {
  local target=$1 our_pid=$$
  # collect our ancestor pids
  local -A our_ancestors
  local p=$our_pid
  while [ "$p" -gt 1 ] 2>/dev/null; do
    our_ancestors[$p]=1
    p=$(awk '{print $4}' "/proc/$p/stat" 2>/dev/null) || break
  done
  # walk target's ancestors — if any overlap, it's a sibling
  p=$target
  while [ "$p" -gt 1 ] 2>/dev/null; do
    [ "${our_ancestors[$p]:-}" ] && return 0
    p=$(awk '{print $4}' "/proc/$p/stat" 2>/dev/null) || break
  done
  return 1
}

if is_sibling "$pid"; then
  echo "free-port: :$port held by pid $pid — sibling process, skipping" >&2
  exit 0
fi

if [[ "$proc_cwd" == "$project_root"* ]]; then
  echo "free-port: killing pid $pid on :$port (cwd: $proc_cwd)" >&2
  kill "$pid"
  # wait for port to actually free up
  for i in $(seq 1 20); do
    ss -tlnp "sport = :$port" 2>/dev/null | grep -q "$port" || exit 0
    sleep 0.1
  done
  echo "free-port: pid $pid didn't release :$port in 2s, sending SIGKILL" >&2
  kill -9 "$pid" 2>/dev/null || true
else
  echo "free-port: :$port held by pid $pid (cwd: $proc_cwd) — not ours, skipping" >&2
fi
