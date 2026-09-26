#!/bin/bash
PY="C:/Users/34498/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
WIN=0
for i in 1 2 3 4 5 6 7 8; do
  echo "===== 第 $i 次 ====="
  "$PY" orchestrate.py > "run_$i.log" 2>&1
  R=$(grep "提交结果" "run_$i.log" | tail -1)
  echo "$R"
  if echo "$R" | grep -q '"success": true'; then
    echo ">>> 第 $i 次成功 <<<"
    WIN=1
    cp orchestrate_result.json success_result.json
    break
  fi
  sleep 4
done
echo "===== 结束，成功标记: $WIN ====="
