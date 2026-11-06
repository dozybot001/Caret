#!/usr/bin/env bash
# 清理服务器上的旧版本：保留当前、上一个和按时间最新的 3 个版本，其余版本连同发布包和站点配置一起删除
# 更早的版本需要时从对应提交重新发布。发布脚本在公网验收通过后执行，清理失败不影响这次发布
# 用法：deploy/retain.sh <站点目录>，例如 /opt/caret
set -euo pipefail
shopt -s nullglob

ROOT=${1:?用法：deploy/retain.sh <站点目录>}
KEEP=3

cd "$ROOT/releases"
current=$(cat "$ROOT/state/current" 2>/dev/null || true)
previous=$(cat "$ROOT/state/previous" 2>/dev/null || true)
# 当前版本和回滚用的上一个版本都要在，否则不猜测删除目标
for name in "$current" "$previous"; do
    if ! [[ $name =~ ^[0-9a-f]{40}$ && -d $name ]]; then
        echo '找不到当前或上一个版本，不清理' >&2
        exit 1
    fi
done

# 只处理发布脚本建立的版本目录，名字是完整的提交号
releases=()
for name in *; do
    if [[ $name =~ ^[0-9a-f]{40}$ && -d $name ]]; then releases+=("$name"); fi
done

rank=0
removed=0
while read -r name; do
    rank=$((rank + 1))
    if [ "$rank" -le "$KEEP" ] || [ "$name" = "$current" ] || [ "$name" = "$previous" ]; then continue; fi
    # 版本里的 vendor 是指向共用 Monaco 的链接，删除版本不会删到 Monaco
    rm -rf "$name" "$name.sha256" "$name.Caddyfile" "$ROOT/incoming/$name.tar.gz"
    removed=$((removed + 1))
done < <(ls -1dt "${releases[@]}")
echo "已清理 $removed 个旧版本，保留 $((rank - removed)) 个"
