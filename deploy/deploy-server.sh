#!/usr/bin/env bash

set -euo pipefail

repository_directory=/data/early-sleep-family-app
binary_path=${repository_directory}/dist/server/early-sleep-server-linux-arm64
data_directory=${repository_directory}/data
listen_address=:31080
health_url=http://127.0.0.1:31080/ping
runtime_directory=${repository_directory}/.deploy-runtime
pid_file=${runtime_directory}/early-sleep-server.pid
last_good_binary=${runtime_directory}/early-sleep-server-linux-arm64.last-good

cd "${repository_directory}"
mkdir -p "${runtime_directory}"

if [[ ! -x ${binary_path} ]]; then
  echo "current server binary is missing or not executable: ${binary_path}" >&2
  exit 1
fi

# Seed the rollback copy before the first automated deployment. On later
# deployments it is refreshed only after the new API passes its health check.
if [[ ! -x ${last_good_binary} ]]; then
  cp "${binary_path}" "${last_good_binary}"
  chmod 0755 "${last_good_binary}"
fi

echo "pulling origin/main in ${repository_directory}"
GIT_TERMINAL_PROMPT=0 git pull --ff-only origin main

if [[ ! -x ${binary_path} ]]; then
  echo "updated server binary is missing or not executable: ${binary_path}" >&2
  exit 1
fi

running_pids=()
if [[ -f ${pid_file} ]]; then
  read -r recorded_pid < "${pid_file}" || true
  if [[ ${recorded_pid:-} =~ ^[0-9]+$ ]] && kill -0 "${recorded_pid}" 2>/dev/null; then
    recorded_command=
    if [[ -r /proc/${recorded_pid}/cmdline ]]; then
      IFS= read -r -d '' recorded_command < "/proc/${recorded_pid}/cmdline" || true
    fi
    if [[ ${recorded_command} == "${binary_path}" || ${recorded_command} == "${last_good_binary}" ]]; then
      running_pids+=("${recorded_pid}")
    else
      echo "ignoring stale PID file for process ${recorded_pid}" >&2
    fi
  fi
fi

# Finds the process started manually before this PID file existed.
while IFS= read -r process_id; do
  [[ -n ${process_id} ]] && running_pids+=("${process_id}")
done < <(pgrep -f -- "^${binary_path}$" || true)

stop_processes() {
  process_ids=("$@")
  (( ${#process_ids[@]} > 0 )) || return 0

  kill "${process_ids[@]}" 2>/dev/null || true

  for _ in {1..20}; do
    still_running=false
    for process_id in "${process_ids[@]}"; do
      if kill -0 "${process_id}" 2>/dev/null; then
        still_running=true
        break
      fi
    done
    [[ ${still_running} == false ]] && break
    sleep 0.5
  done

  for process_id in "${process_ids[@]}"; do
    if kill -0 "${process_id}" 2>/dev/null; then
      kill -KILL "${process_id}" 2>/dev/null || true
    fi
  done
}

if (( ${#running_pids[@]} > 0 )); then
  echo "stopping old API process"
  stop_processes "${running_pids[@]}"
fi

start_server() {
  executable=$1
  nohup env \
    DATA_DIR="${data_directory}" \
    LISTEN_ADDR="${listen_address}" \
    "${executable}" >/dev/null 2>&1 </dev/null &
  server_pid=$!
  printf '%s\n' "${server_pid}" > "${pid_file}"
}

wait_until_healthy() {
  process_id=$1
  for _ in {1..15}; do
    if ! kill -0 "${process_id}" 2>/dev/null; then
      return 1
    fi
    if curl --fail --silent --show-error --max-time 3 "${health_url}" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

echo "starting updated API"
start_server "${binary_path}"
new_pid=${server_pid}

if wait_until_healthy "${new_pid}"; then
  temporary_last_good=${last_good_binary}.new
  cp "${binary_path}" "${temporary_last_good}"
  chmod 0755 "${temporary_last_good}"
  mv -f "${temporary_last_good}" "${last_good_binary}"
  echo "deployment succeeded; API PID is ${new_pid}"
  exit 0
fi

echo "updated API failed its health check; starting the last good version" >&2
stop_processes "${new_pid}"
start_server "${last_good_binary}"
rollback_pid=${server_pid}

if wait_until_healthy "${rollback_pid}"; then
  echo "rollback succeeded; API PID is ${rollback_pid}" >&2
else
  echo "rollback also failed; manual recovery is required" >&2
fi

exit 1
