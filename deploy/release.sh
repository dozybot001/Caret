#!/usr/bin/env bash
# 发布 Caret：检查依赖漏洞和密钥，从确定的提交导出静态文件，上传到服务器，切换站点，公网验收，失败时恢复，成功后清理旧版本
# 用法：deploy/release.sh [rollback | maintenance on|off]
set -euo pipefail

SERVER=agenthub-prod
ROOT=/opt/caret
FILES=(404.html 500.html maintenance.html migrate.html LICENSE index.html apple-touch-icon.png .well-known assets css src)
# 主机公钥固定在 deploy/known_hosts，不信任开发机上临时记下的公钥
SSH_OPTIONS=(-o BatchMode=yes -o ConnectTimeout=15 -o HostKeyAlias="$SERVER" -o UserKnownHostsFile=deploy/known_hosts -o StrictHostKeyChecking=yes)
SSH=(ssh "${SSH_OPTIONS[@]}" "$SERVER")

cd "$(dirname "$0")/.."

# 线上地址、切换前先上线的新地址和迁走之前的旧地址，见 src/app/site.js
site_constant() {
    sed -n "s/^export const $1 = '\(.*\)';$/\1/p" src/app/site.js
}
DOMAIN=$(site_constant DOMAIN)
LEGACY_DOMAIN=$(site_constant LEGACY_DOMAIN)
NEXT_DOMAIN=$(site_constant NEXT_DOMAIN)
ORIGIN=https://$DOMAIN

# 服务器端：把 Caddy 站点切到指定版本，验证配置后重载
read -r -d '' ACTIVATE <<REMOTE || true
set -euo pipefail
ROOT=$ROOT
SITE=/etc/caddy/sites-enabled/caret.caddy

# 站点配置跟着版本存放，回滚时一起恢复。早期版本没有自己的配置，用当时共用的那份
activate() {
    local release=\$1 backup template=\$ROOT/releases/\$1.Caddyfile
    [ -f "\$template" ] || template=\$ROOT/caret.Caddyfile
    backup=\$(mktemp)
    if [ -f "\$SITE" ]; then cp -p "\$SITE" "\$backup"; fi
    sed "s#__RELEASE__#\$ROOT/releases/\$release#g" "\$template" > "\$SITE"
    if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
        if [ -s "\$backup" ]; then cp -p "\$backup" "\$SITE"; else rm -f "\$SITE"; fi
        rm -f "\$backup"
        echo 'Caddy 配置无效，站点未切换' >&2
        return 1
    fi
    rm -f "\$backup"
    systemctl reload caddy
    systemctl is-active --quiet caddy
    if [ -f "\$ROOT/state/current" ]; then cp "\$ROOT/state/current" "\$ROOT/state/previous"; fi
    echo "\$release" > "\$ROOT/state/current"
}
REMOTE

remote() {
    "${SSH[@]}" 'sudo -n bash -s'
}

# 公网验收在服务器上执行，不受开发机网络影响：页面、资源类型、安全响应头、404，以及不该发布的文件
read -r -d '' SMOKE <<'REMOTE' || true
fail() {
    echo "公网验收失败：$1" >&2
    exit 1
}

fetch() {
    curl -fsS --retry 3 --retry-all-errors --retry-delay 2 -m 15 "$@"
}

status_of() {
    curl -s --retry 3 --retry-delay 2 -m 15 -o /dev/null -w '%{http_code}' "$ORIGIN/$1"
}

# 新域名第一次访问时要签发证书
for _ in $(seq 1 30); do
    if curl -fsS -m 8 -o /dev/null "$ORIGIN/"; then break; fi
    sleep 2
done

body=$(fetch "$ORIGIN/") || fail '首页不可用'
[[ $body == *'<title>Caret</title>'* ]] || fail '首页内容不对'

body=$(fetch "$ORIGIN/src/app/constants.js") || fail '脚本不可用'
[[ $body == *"VERSION = '$EXPECTED'"* ]] || fail '线上版本不对'
body=$(fetch "$ORIGIN/src/app/build.js") || fail '构建号不可用'
[[ $body == *"'$COMMIT'"* ]] || fail '构建号不对'

headers=$(fetch -I "$ORIGIN/") || fail '读不到响应头'
for name in strict-transport-security content-security-policy x-content-type-options referrer-policy x-frame-options; do
    grep -qi "^$name:" <<<"$headers" || fail "缺少响应头 $name"
done
grep -qi '^strict-transport-security: max-age=31536000; includeSubDomains' <<<"$headers" || fail 'HSTS 不对'
grep -qi "frame-ancestors 'none'" <<<"$headers" || fail 'CSP 缺少 frame-ancestors'
grep -qi 'cdnjs' <<<"$headers" && fail 'CSP 里还有第三方脚本'
grep -qi '^cache-control: no-cache' <<<"$headers" || fail '页面的缓存策略不对'

headers=$(fetch -I "$ORIGIN/src/main.js") || fail 'main.js 不可用'
grep -qi '^content-type: text/javascript' <<<"$headers" || fail 'main.js 类型不对'
[ "$(status_of css/codicons/codicon.ttf)" = 200 ] || fail '图标字体不可用'
headers=$(fetch -I "$ORIGIN/LICENSE") || fail '许可证不可用'
grep -qi '^content-type: text/plain; charset=utf-8' <<<"$headers" || fail '许可证的类型不对'
[ "$(status_of assets/share.png)" = 200 ] || fail '分享图不可用'
[ "$(status_of apple-touch-icon.png)" = 200 ] || fail '手机桌面图标不可用'

headers=$(fetch -I "$ORIGIN/vendor/monaco-0.52.2/vs/loader.js") || fail 'Monaco 不可用'
grep -qi '^cache-control: public' <<<"$headers" || fail 'Monaco 的缓存策略不对'
grep -qi 'content-security-policy' <<<"$headers" || fail 'Monaco 缺少 CSP'
[ "$(status_of vendor/monaco-0.52.2/vs/base/worker/workerMain.js)" = 200 ] || fail 'Monaco Worker 不可用'
[ "$(status_of vendor/monaco-0.52.2/vs/nls.messages.zh-cn.js)" = 200 ] || fail 'Monaco 语言包不可用'

body=$(fetch "$ORIGIN/.well-known/security.txt") || fail 'security.txt 不可用'
[[ $body == *'Contact: mailto:support@tenonai.cn'* ]] || fail 'security.txt 不对'

[ "$(status_of 500.html)" = 200 ] || fail '500 页不可用'
[ "$(status_of maintenance.html)" = 200 ] || fail '维护页不可用'
[ "$(status_of not-a-page)" = 404 ] || fail '不存在的地址没有返回 404'
body=$(curl -s --retry 3 --retry-delay 2 -m 15 "$ORIGIN/not-a-page")
[[ $body == *'Page not found'* ]] || fail '404 页面不对'

for path in tests/agent.test.mjs docs/design-guidelines.md deploy/release.sh README.md .git/config; do
    [ "$(status_of "$path")" = 404 ] || fail "$path 不应该被发布"
done

# 迁移期间的旧地址：301 到新地址并保留路径和参数，只有迁移页面照常返回
if [ -n "$LEGACY" ]; then
    moved=$(curl -s --retry 3 --retry-delay 2 -m 15 -o /dev/null -w '%{http_code} %{redirect_url}' "https://$LEGACY/docs/a?b=1")
    [ "$moved" = "301 $ORIGIN/docs/a?b=1" ] || fail "旧地址没有跳到新地址：$moved"
    headers=$(curl -sI --retry 3 --retry-delay 2 -m 15 "https://$LEGACY/") || fail '旧地址不可用'
    grep -qi '^strict-transport-security: max-age=31536000; includeSubDomains' <<<"$headers" || fail '旧地址的 HSTS 不对'
    body=$(fetch "https://$LEGACY/migrate.html") || fail '旧地址的迁移页面不可用'
    [[ $body == *"const TARGET = '$ORIGIN'"* ]] || fail '迁移页面的目标地址不对'
fi

# 切换前先上线的新地址，首次访问时签证书。签不下来只提示，不回滚线上地址；也不要反复发布，同一地址每小时最多失败 5 次
if [ -n "$NEXT" ]; then
    for _ in $(seq 1 30); do
        if curl -fsS -m 8 -o /dev/null "https://$NEXT/"; then break; fi
        sleep 2
    done
    body=$(curl -fsS -m 15 "https://$NEXT/src/app/build.js" 2>/dev/null || true)
    headers=$(curl -fsSI -m 15 "https://$NEXT/" 2>/dev/null || true)
    if [[ $body == *"'$COMMIT'"* ]] && grep -qi '^strict-transport-security: max-age=31536000; includeSubDomains' <<<"$headers"; then
        echo "新地址 https://$NEXT/ 已可用"
    else
        echo "新地址 https://$NEXT/ 还不可用，可能是证书没签下来。不要反复发布，告诉安全组" >&2
    fi
fi
REMOTE

smoke() {
    remote <<EOS
ORIGIN=$ORIGIN
LEGACY=$LEGACY_DOMAIN
NEXT=$NEXT_DOMAIN
EXPECTED=$1
COMMIT=$2
$SMOKE
EOS
}

version_of() {
    sed -n "s/^export const VERSION = '\(.*\)';$/\1/p" src/app/constants.js
}

if [ "${1:-}" = maintenance ]; then
    case "${2:-}" in
        on) "${SSH[@]}" "sudo -n touch $ROOT/state/maintenance" ;;
        off) "${SSH[@]}" "sudo -n rm -f $ROOT/state/maintenance" ;;
        *) echo '用法：deploy/release.sh maintenance on|off' >&2; exit 1 ;;
    esac
    exit 0
fi

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
node --test >/dev/null

# 密钥扫描：常见的 API Key、云平台和代码托管令牌、私钥
SECRETS='sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
if git grep -nIE "$SECRETS" "$SHA" -- . >&2; then
    echo '发现疑似密钥，停止发布。先撤销并更换密钥，再清理提交' >&2
    exit 1
fi

# 依赖漏洞检查：唯一的第三方依赖是 vendor 里的 Monaco，按版本查询 OSV
MONACO=$(git ls-tree --name-only "$SHA" vendor/ | sed -n 's#^vendor/monaco-##p')
ADVISORIES=$(curl -fsS --retry 2 -m 20 https://api.osv.dev/v1/query \
    -d "{\"package\":{\"name\":\"monaco-editor\",\"ecosystem\":\"npm\"},\"version\":\"$MONACO\"}") \
    || { echo '查询不到依赖漏洞，停止发布' >&2; exit 1; }
[ "$ADVISORIES" = '{}' ] || { echo "Monaco $MONACO 有已知漏洞，修复或写明豁免理由后再发布：$ADVISORIES" >&2; exit 1; }

# 新地址要已经解析到服务器，并且不再按未备案被拦截，否则证书签不下来，验证失败多了还会拉长重试间隔
ADDRESS=$(ssh -G "$SERVER" 2>/dev/null | awk '$1 == "hostname" { print $2 }')
[[ $ADDRESS =~ ^[0-9.]+$ ]] || ADDRESS=$(dig +short A "$ADDRESS" | tail -1)
for host in "$DOMAIN" ${NEXT_DOMAIN:+"$NEXT_DOMAIN"}; do
    [ "$(dig +short A "$host" @119.29.29.29 | tail -1)" = "$ADDRESS" ] || { echo "$host 还没有解析到服务器，不发布" >&2; exit 1; }
    if curl -s -m 10 -o /dev/null -w '%{redirect_url}' "http://$host/" | grep -q webblock; then
        echo "$host 仍被按未备案拦截，不发布" >&2
        exit 1
    fi
done

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git archive --format=tar "$SHA" "${FILES[@]}" | gzip -n > "$WORK/site.tar.gz"
DIGEST=$(shasum -a 256 "$WORK/site.tar.gz" | cut -d' ' -f1)
{
    sed "s#__ADDRESSES__#$DOMAIN${NEXT_DOMAIN:+, $NEXT_DOMAIN}#g" deploy/caret.Caddyfile
    if [ -n "$LEGACY_DOMAIN" ]; then
        echo
        sed -e "s#__DOMAIN__#$DOMAIN#g" -e "s#__LEGACY__#$LEGACY_DOMAIN#g" deploy/legacy.Caddyfile
    fi
} > "$WORK/caret.Caddyfile"

"${SSH[@]}" "sudo -n install -d -m 0755 $ROOT $ROOT/releases $ROOT/state && sudo -n install -d -o ubuntu -g ubuntu -m 0700 $ROOT/incoming"

# Monaco 很大而且很少变，所有版本共用服务器上的一份，内容变化时才上传
VENDOR=$(git rev-parse "$SHA:vendor")
if [ "$("${SSH[@]}" "cat $ROOT/state/vendor 2>/dev/null || true")" != "$VENDOR" ]; then
    git archive --format=tar "$SHA" vendor | gzip -n > "$WORK/vendor.tar.gz"
    scp -q "${SSH_OPTIONS[@]}" "$WORK/vendor.tar.gz" "$SERVER:$ROOT/incoming/vendor.tar.gz"
    remote <<EOS
set -euo pipefail
tar -xzf $ROOT/incoming/vendor.tar.gz -C $ROOT
chown -R root:root $ROOT/vendor
chmod -R u=rwX,go=rX $ROOT/vendor
rm -f $ROOT/incoming/vendor.tar.gz
echo $VENDOR > $ROOT/state/vendor
EOS
fi
scp -q "${SSH_OPTIONS[@]}" "$WORK/site.tar.gz" "$SERVER:$ROOT/incoming/$SHA.tar.gz"
scp -q "${SSH_OPTIONS[@]}" "$WORK/caret.Caddyfile" "$SERVER:$ROOT/incoming/caret.Caddyfile"

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
    ln -s \$ROOT/vendor "\$staging/vendor"
    echo "$DIGEST" > "\$target.sha256"
    mv "\$staging" "\$target"
fi
install -m 0644 -o root -g root \$ROOT/incoming/caret.Caddyfile "\$target.Caddyfile"
rm -f "\$archive" \$ROOT/incoming/caret.Caddyfile
activate "$SHA"
EOS

if ! smoke "$(version_of)" "$SHA"; then
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

# 保留规则见 deploy/retain.sh
"${SSH[@]}" "sudo -n bash -s $ROOT" < deploy/retain.sh || echo '旧版本没有清理，这次发布不受影响' >&2

echo "已发布 $SHA 到 $ORIGIN${NEXT_DOMAIN:+，新地址 https://$NEXT_DOMAIN/ 一起提供}"
