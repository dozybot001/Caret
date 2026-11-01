#!/usr/bin/env bash
# 发布 Caret：从确定的提交导出静态文件，上传到服务器，切换站点，公网验收，失败时恢复
# 用法：deploy/release.sh [rollback]
set -euo pipefail

SERVER=agenthub-prod
ROOT=/opt/caret
ORIGIN=https://caret.tenon.asia
FILES=(404.html LICENSE index.html main.js style.css .well-known css src)
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER")

cd "$(dirname "$0")/.."

# 服务器端：把 Caddy 站点切到指定版本，验证配置后重载
read -r -d '' ACTIVATE <<REMOTE || true
set -euo pipefail
ROOT=$ROOT
SITE=/etc/caddy/sites-enabled/caret.caddy

activate() {
    local release=\$1 backup
    backup=\$(mktemp)
    if [ -f "\$SITE" ]; then cp -p "\$SITE" "\$backup"; fi
    sed "s#__RELEASE__#\$ROOT/releases/\$release#" "\$ROOT/caret.Caddyfile" > "\$SITE"
    if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
        if [ -s "\$backup" ]; then cp -p "\$backup" "\$SITE"; else rm -f "\$SITE"; fi
        echo 'Caddy 配置无效，站点未切换' >&2
        return 1
    fi
    systemctl reload caddy
    systemctl is-active --quiet caddy
    if [ -f "\$ROOT/state/current" ]; then cp "\$ROOT/state/current" "\$ROOT/state/previous"; fi
    echo "\$release" > "\$ROOT/state/current"
}
REMOTE

remote() {
    "${SSH[@]}" 'sudo -n bash -s'
}

status_of() {
    curl -s -m 15 -o /dev/null -w '%{http_code}' "$ORIGIN/$1"
}

# 公网验收：页面、资源类型、安全响应头、404，以及不该发布的文件
smoke() {
    local expected=$1 body headers name path
    for _ in $(seq 1 30); do
        if curl -fsS -m 8 -o /dev/null "$ORIGIN/"; then break; fi
        sleep 2
    done

    body=$(curl -fsS -m 15 "$ORIGIN/") || return 1
    [[ $body == *'<title>Caret</title>'* ]] || { echo '首页内容不对' >&2; return 1; }

    body=$(curl -fsS -m 15 "$ORIGIN/src/global/constants.js") || return 1
    [[ $body == *"VERSION = '$expected'"* ]] || { echo '线上版本不对' >&2; return 1; }

    headers=$(curl -fsSI -m 15 "$ORIGIN/") || return 1
    for name in strict-transport-security content-security-policy x-content-type-options referrer-policy x-frame-options; do
        grep -qi "^$name:" <<<"$headers" || { echo "缺少响应头 $name" >&2; return 1; }
    done
    grep -qi "frame-ancestors 'none'" <<<"$headers" || { echo 'CSP 缺少 frame-ancestors' >&2; return 1; }

    headers=$(curl -fsSI -m 15 "$ORIGIN/main.js") || return 1
    grep -qi '^content-type: text/javascript' <<<"$headers" || { echo 'main.js 类型不对' >&2; return 1; }
    [ "$(status_of css/codicons/codicon.ttf)" = 200 ] || { echo '图标字体不可用' >&2; return 1; }

    body=$(curl -fsS -m 15 "$ORIGIN/.well-known/security.txt") || return 1
    [[ $body == *'Contact: mailto:support@tenonai.cn'* ]] || { echo 'security.txt 不对' >&2; return 1; }

    [ "$(status_of not-a-page)" = 404 ] || { echo '不存在的地址没有返回 404' >&2; return 1; }
    body=$(curl -s -m 15 "$ORIGIN/not-a-page")
    [[ $body == *'Page not found'* ]] || { echo '404 页面不对' >&2; return 1; }

    for path in test.mjs deploy/release.sh README.md .git/config; do
        [ "$(status_of "$path")" = 404 ] || { echo "$path 不应该被发布" >&2; return 1; }
    done
}

version_of() {
    sed -n "s/^export const VERSION = '\(.*\)';$/\1/p" src/global/constants.js
}

if [ "${1:-}" = rollback ]; then
    remote <<EOS
$ACTIVATE
activate "\$(cat \$ROOT/state/previous)"
cat \$ROOT/state/current
EOS
    exit 0
fi

[ -z "$(git status --porcelain)" ] || { echo '工作区有未提交的改动' >&2; exit 1; }
SHA=$(git rev-parse HEAD)
node --test test.mjs >/dev/null

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git archive --format=tar "$SHA" "${FILES[@]}" | gzip -n > "$WORK/site.tar.gz"
DIGEST=$(shasum -a 256 "$WORK/site.tar.gz" | cut -d' ' -f1)

"${SSH[@]}" "sudo -n install -d -m 0755 $ROOT $ROOT/releases $ROOT/state && sudo -n install -d -o ubuntu -g ubuntu -m 0700 $ROOT/incoming"
scp -q -o BatchMode=yes "$WORK/site.tar.gz" "$SERVER:$ROOT/incoming/$SHA.tar.gz"
scp -q -o BatchMode=yes deploy/caret.Caddyfile "$SERVER:$ROOT/incoming/caret.Caddyfile"

remote <<EOS
$ACTIVATE
archive=\$ROOT/incoming/$SHA.tar.gz
echo "$DIGEST  \$archive" | sha256sum -c --quiet -
target=\$ROOT/releases/$SHA
if [ -d "\$target" ]; then
    [ "\$(cat "\$target.sha256")" = "$DIGEST" ] || { echo '同一提交的内容不同，拒绝发布' >&2; exit 1; }
else
    staging=\$(mktemp -d \$ROOT/incoming/unpack.XXXXXX)
    tar -xzf "\$archive" -C "\$staging"
    chown -R root:root "\$staging"
    chmod -R u=rwX,go=rX "\$staging"
    echo "$DIGEST" > "\$target.sha256"
    mv "\$staging" "\$target"
fi
install -m 0644 -o root -g root \$ROOT/incoming/caret.Caddyfile \$ROOT/caret.Caddyfile
rm -f "\$archive" \$ROOT/incoming/caret.Caddyfile
activate "$SHA"
EOS

if ! smoke "$(version_of)"; then
    echo '公网验收失败，正在恢复' >&2
    remote <<EOS
$ACTIVATE
if [ -s \$ROOT/state/previous ]; then
    activate "\$(cat \$ROOT/state/previous)"
else
    rm -f "\$SITE" \$ROOT/state/current
    systemctl reload caddy
fi
EOS
    exit 1
fi

echo "已发布 $SHA 到 $ORIGIN"
