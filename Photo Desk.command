#!/bin/zsh

set -u

script_dir="${0:A:h}"
cd "$script_dir" || exit 1

npm run photos:manage &
photo_desk_pid=$!

cleanup() {
    if kill -0 "$photo_desk_pid" 2>/dev/null; then
        kill "$photo_desk_pid" 2>/dev/null
    fi
}

trap cleanup EXIT INT TERM

for attempt in {1..30}; do
    if curl --silent --fail http://127.0.0.1:4173/ >/dev/null 2>&1; then
        open http://127.0.0.1:4173/
        break
    fi
    sleep 0.2
done

wait "$photo_desk_pid"
