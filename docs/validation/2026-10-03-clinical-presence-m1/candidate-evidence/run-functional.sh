#!/usr/bin/env bash
set -u
label=$1
shift
evidence_root=/tmp/yunshan-clinical-presence-m1-prep-20261003/evidence
run_dir="$evidence_root/$label"
mkdir -p "$run_dir"
python3 "$evidence_root/freeze.py" "$PWD" > "$run_dir/source-before.sha256"
date -u --iso-8601=ns > "$run_dir/start.utc"
printf '%s\n' "$PWD" > "$run_dir/cwd.txt"
printf '%s\n' "$@" > "$run_dir/argv.txt"
"$@" > "$run_dir/raw.log" 2>&1 &
task_pid=$!
printf '%s\n' "$task_pid" > "$run_dir/pid.txt"
printf 'functional job %s PID %s\n' "$label" "$task_pid"
wait "$task_pid"
result=$?
date -u --iso-8601=ns > "$run_dir/end.utc"
printf '%s\n' "$result" > "$run_dir/exit-code.txt"
python3 "$evidence_root/freeze.py" "$PWD" > "$run_dir/source-after.sha256"
if cmp -s "$run_dir/source-before.sha256" "$run_dir/source-after.sha256"; then printf 'unchanged\n' > "$run_dir/freeze-status.txt"; else printf 'changed\n' > "$run_dir/freeze-status.txt"; fi
printf 'functional job %s exit %s freeze ' "$label" "$result"
cat "$run_dir/freeze-status.txt"
tail -65 "$run_dir/raw.log"
exit "$result"
