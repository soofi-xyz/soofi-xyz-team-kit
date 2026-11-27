#!/bin/bash
# Mortgage document worker (runs on an AWS machine as user ubuntu).
# TASKS is a space-separated list of county:year:shard[:limit], e.g. "dallas:2026:0/8 duval:2026:0/1:20".
# Each task runs in parallel: it pulls that county-year's index from S3, downloads every document
# in its shard to S3 (documents already stored are skipped), and retries until complete.
# Logs go to s3://$BUCKET/worker-logs/<instance-id>/ every 5 minutes. When every task is
# finished the machine shuts itself down (and is terminated).
set -u
BUCKET=${BUCKET:-elephant-mortgage-documents-904370092316}
CHROME=/usr/bin/google-chrome
cd /opt/mortgage/runtime
TOKEN=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')
ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
mkdir -p logs data/idx
sync_logs() { aws s3 sync logs "s3://$BUCKET/worker-logs/$ID/" --quiet || true; }
( while true; do sleep 300; sync_logs; done ) &
SYNCER=$!

index_dirs() { # <county> -> "<county>/<job> ..." as stored under s3://bucket/indexes/
  case $1 in
    duval|hillsborough) echo "$1/full-20261126" ;;
    maricopa|mecklenburg) echo "$1/recent-20261127" ;;
    dallas|tarrant|bexar|denton) echo "$1/recent-20261127 $1/tx-extra-20261126" ;;
    collin) echo "$1/recent-20261127" ;;
  esac
}
flags() { # <county>
  case $1 in
    duval) echo "--concurrency 1 --delay-ms 500" ;;
    hillsborough) echo "--concurrency 4 --delay-ms 500" ;;
    maricopa) echo "--concurrency 2 --delay-ms 500 --chrome $CHROME" ;;
    mecklenburg) echo "--concurrency 1 --delay-ms 300 --chrome $CHROME" ;;
    *) echo "--concurrency 1 --page-concurrency 4 --page-delay-ms 150 --delay-ms 600 --chrome $CHROME" ;;
  esac
}

run_task() { # county:year:shard[:limit]
  local c y shard limit
  IFS=: read -r c y shard limit <<< "$1"
  limit=${limit:-100000000}
  local log="logs/$c-$y-${shard/\//of}.log"
  for d in $(index_dirs $c); do
    local local_dir="data/idx/$d"
    mkdir -p "$local_dir"
    aws s3 sync "s3://$BUCKET/indexes/$d/" "$local_dir/" --exclude '*' --include "$y*.jsonl" --quiet
    ls "$local_dir"/$y*.jsonl >/dev/null 2>&1 || { echo "{\"event\":\"no_index\",\"dir\":\"$d\",\"year\":$y}" >> "$log"; continue; }
    for attempt in 1 2 3 4 5; do
      xvfb-run -a node bin/elephant-county.mjs mortgage-documents --county $c --index-dir "$local_dir" \
        --year $y --shard $shard --bucket $BUCKET --limit $limit $(flags $c) >> "$log" 2>&1
      # Exit 3: interactive human check. Stop this task; never retry it automatically.
      if [ $? -eq 3 ]; then echo "{\"event\":\"task_blocked_challenge\",\"task\":\"$1\"}" >> "$log"; return 3; fi
      tail -3 "$log" | grep -q mortgage_documents_complete && break
      echo "{\"event\":\"task_retry\",\"attempt\":$attempt}" >> "$log"; sleep 60
    done
  done
  echo "{\"event\":\"task_done\",\"task\":\"$1\"}" >> "$log"
}

index_task() { # index:county:year[:delay-ms] - build one Texas county-year list and upload it
  local kind c y delay
  IFS=: read -r kind c y delay <<< "$1"
  delay=${delay:-5000}
  local log="logs/index-$c-$y.log" to=$([ "$y" = 2026 ] && echo 20261126 || echo "${y}1231")
  xvfb-run -a node bin/elephant-county.mjs mortgage-index-harvest --county $c --job-id recent-20261127 \
    --from ${y}0101 --to $to --delay-ms $delay --chrome $CHROME --output data/artifacts/mortgage-index >> "$log" 2>&1
  local rc=$?
  [ $rc -eq 3 ] && echo "{\"event\":\"task_blocked_challenge\",\"task\":\"$1\"}" >> "$log"
  aws s3 sync data/artifacts/mortgage-index/$c/recent-20261127/windows/ "s3://$BUCKET/indexes/$c/recent-20261127/" --quiet
  echo "{\"event\":\"index_task_done\",\"task\":\"$1\",\"rc\":$rc}" >> "$log"
}

for t in $TASKS; do
  case $t in index:*) index_task "$t" & ;; *) run_task "$t" & ;; esac
done
wait $(jobs -p | grep -v "^$SYNCER$")
kill $SYNCER; sync_logs
[ "${NO_SHUTDOWN:-0}" = 1 ] || sudo shutdown -h now
