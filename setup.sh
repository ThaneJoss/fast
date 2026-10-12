#Setup
# curl -fsSL https://fast.thanejoss.com/ | sudo bash
### fast.thanejoss.com Version __FAST_VERSION__

set -e
fast_version='__FAST_VERSION__'
. /etc/os-release

fast_ubuntu_block() {
  cat <<EOF
### fast.thanejoss.com/$1 Version $fast_version
Types: deb
URIs: https://fast.thanejoss.com/$1/ubuntu/
Suites: $2
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
### End Version $fast_version
EOF
}

fast_ubuntu_is_current() {
  [ -f /etc/apt/sources.list.d/ubuntu.sources ] || return 1
  # Compare the whole deb822 stanza, not just its version comments. Fields
  # outside the comments (for example Enabled: no) also affect the source.
  awk -v expected="$1" '
    BEGIN { RS = "" }
    $0 == expected { found = 1 }
    END { exit !found }
  ' /etc/apt/sources.list.d/ubuntu.sources
}

## archive.ubuntu.com
fast_ubuntu_expected=$(fast_ubuntu_block archive.ubuntu.com "${VERSION_CODENAME} ${VERSION_CODENAME}-updates ${VERSION_CODENAME}-backports")
if fast_ubuntu_is_current "$fast_ubuntu_expected"; then
  printf '%s\n' '[未修改] Ubuntu 主源 (archive.ubuntu.com)：配置已与当前版本一致'
else
  if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
    # Remove the complete managed stanza, including fields outside its comments.
    sed -i -E '
      /^[[:blank:]]*$/b
      :stanza
      $!{
        N
        /\n[[:blank:]]*$/!b stanza
      }
      /(^|\n)### fast[.]thanejoss[.]com\/archive[.]ubuntu[.]com Version /d
    ' /etc/apt/sources.list.d/ubuntu.sources
  fi
  for source_file in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do
    [ -f "$source_file" ] || continue
    sed -i -E '/^[[:blank:]]*deb(-src)?[[:blank:]]+(\[[^]]*\][[:blank:]]+)?https?:\/\/(fast[.]thanejoss[.]com\/)?archive[.]ubuntu[.]com\/ubuntu\/?([[:blank:]]|$)/d' "$source_file"
  done
  for source_file in /etc/apt/sources.list.d/*.sources; do
    [ -f "$source_file" ] || continue
    sed -i -E '
      /^[[:blank:]]*$/b
      :stanza
      $!{
        N
        /\n[[:blank:]]*$/!b stanza
      }
      /(^|\n)URIs:([^\n]|\n[[:blank:]])*https?:\/\/(fast[.]thanejoss[.]com\/)?archive[.]ubuntu[.]com\/ubuntu\/?([[:space:]]|$)/!b
      :uris
      s/(^|\n)(URIs:[^\n]*)\n[[:blank:]]+([^[:blank:]\n])/\1\2 \3/
      t uris
      :source
      s#(^|\n)(URIs:|URIs:[^\n]*[[:blank:]])https?://(fast[.]thanejoss[.]com/)?archive[.]ubuntu[.]com/ubuntu/?([[:blank:]]|\n|$)#\1\2\4#
      t source
      /(^|\n)URIs:[[:blank:]]*(\n|$)/d
    ' "$source_file"
  done
  printf '\n\n%s\n' "$fast_ubuntu_expected" >> /etc/apt/sources.list.d/ubuntu.sources
  printf '%s\n' '[已修改] Ubuntu 主源 (archive.ubuntu.com)'
fi

## security.ubuntu.com
fast_ubuntu_expected=$(fast_ubuntu_block security.ubuntu.com "${VERSION_CODENAME}-security")
if fast_ubuntu_is_current "$fast_ubuntu_expected"; then
  printf '%s\n' '[未修改] Ubuntu 安全源 (security.ubuntu.com)：配置已与当前版本一致'
else
  if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
    sed -i -E '
      /^[[:blank:]]*$/b
      :stanza
      $!{
        N
        /\n[[:blank:]]*$/!b stanza
      }
      /(^|\n)### fast[.]thanejoss[.]com\/security[.]ubuntu[.]com Version /d
    ' /etc/apt/sources.list.d/ubuntu.sources
  fi
  for source_file in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do
    [ -f "$source_file" ] || continue
    sed -i -E '/^[[:blank:]]*deb(-src)?[[:blank:]]+(\[[^]]*\][[:blank:]]+)?https?:\/\/(fast[.]thanejoss[.]com\/)?security[.]ubuntu[.]com\/ubuntu\/?([[:blank:]]|$)/d' "$source_file"
  done
  for source_file in /etc/apt/sources.list.d/*.sources; do
    [ -f "$source_file" ] || continue
    sed -i -E '
      /^[[:blank:]]*$/b
      :stanza
      $!{
        N
        /\n[[:blank:]]*$/!b stanza
      }
      /(^|\n)URIs:([^\n]|\n[[:blank:]])*https?:\/\/(fast[.]thanejoss[.]com\/)?security[.]ubuntu[.]com\/ubuntu\/?([[:space:]]|$)/!b
      :uris
      s/(^|\n)(URIs:[^\n]*)\n[[:blank:]]+([^[:blank:]\n])/\1\2 \3/
      t uris
      :source
      s#(^|\n)(URIs:|URIs:[^\n]*[[:blank:]])https?://(fast[.]thanejoss[.]com/)?security[.]ubuntu[.]com/ubuntu/?([[:blank:]]|\n|$)#\1\2\4#
      t source
      /(^|\n)URIs:[[:blank:]]*(\n|$)/d
    ' "$source_file"
  done
  printf '\n\n%s\n' "$fast_ubuntu_expected" >> /etc/apt/sources.list.d/ubuntu.sources
  printf '%s\n' '[已修改] Ubuntu 安全源 (security.ubuntu.com)'
fi

## registry.npmjs.org
# sudo configures the invoking user's npm, including npm installed later via nvm.
fast_registry=__FAST_NPM_REGISTRY__
fast_npm_user=$(id -un)
if [ "$(id -u)" = 0 ] && [ -n "${SUDO_USER:-}" ]; then
  fast_npm_user=$SUDO_USER
fi
fast_npm_home=$(getent passwd "$fast_npm_user" | cut -d: -f6)
if [ -z "$fast_npm_home" ]; then
  printf 'Cannot find home directory for %s\n' "$fast_npm_user" >&2
  exit 1
fi
# Resolve links before replacing the file so a symlinked .npmrc stays a symlink.
fast_npm_config=$(readlink -m -- "$fast_npm_home/.npmrc")
fast_npm_input=/dev/null
[ ! -e "$fast_npm_config" ] || fast_npm_input=$fast_npm_config
fast_npm_tmp=$(mktemp "${fast_npm_config}.fast.XXXXXX")
trap 'rm -f -- "$fast_npm_tmp"' EXIT
awk -v registry="$fast_registry" '
  /^[[:blank:]]*registry[[:blank:]]*=/ {
    if (!written++) print "registry=" registry
    next
  }
  { print }
  END { if (!written) print "registry=" registry }
' "$fast_npm_input" > "$fast_npm_tmp"
if ! cmp -s -- "$fast_npm_tmp" "$fast_npm_config"; then
  if [ -e "$fast_npm_config" ]; then
    chown --reference="$fast_npm_config" "$fast_npm_tmp"
    chmod --reference="$fast_npm_config" "$fast_npm_tmp"
  else
    chown "$fast_npm_user:$(id -gn "$fast_npm_user")" "$fast_npm_tmp"
  fi
  mv -f -- "$fast_npm_tmp" "$fast_npm_config"
  printf '[已修改] npm registry (%s)：%s\n' "$fast_npm_config" "$fast_registry"
else
  printf '[未修改] npm registry (%s)：已是 %s\n' "$fast_npm_config" "$fast_registry"
fi
rm -f -- "$fast_npm_tmp"
trap - EXIT

## SSH: the Windows Ed25519 public key explicitly selected by the user.
fast_ssh_write() (
  set -e
  local ssh_home=$1 uid=$2 gid=$3 key=$4 fingerprint=$5 tmp='' lock existing mode changed=0
  trap 'if [ -n "$tmp" ]; then rm -f -- "$tmp"; fi' EXIT
  [ "$(id -u)" = "$uid" ] && [ "$uid" != 0 ] || { printf '%s\n' '[错误] SSH：写入必须使用目标非 root 用户身份' >&2; exit 1; }
  [[ "$ssh_home" = /* && "$ssh_home" != / ]] && [ -d "$ssh_home" ] && [ -x "$ssh_home" ] && [ "$(readlink -e -- "$ssh_home")" = "$ssh_home" ] && [ "$(stat -c %u -- "$ssh_home")" = "$uid" ] || { printf '%s\n' '[错误] SSH：用户主目录不存在、属主错误或路径含符号链接' >&2; exit 1; }
  mode=$(stat -c %a -- "$ssh_home")
  (( (8#$mode & 0022) == 0 )) || { printf '%s\n' '[错误] SSH：用户主目录不能允许组或其他用户写入' >&2; exit 1; }
  [ ! -L "$ssh_home/.ssh" ] && { [ ! -e "$ssh_home/.ssh" ] || { [ -d "$ssh_home/.ssh" ] && [ "$(stat -c %u -- "$ssh_home/.ssh")" = "$uid" ]; }; } || { printf '%s\n' '[错误] SSH：.ssh 路径或属主不安全' >&2; exit 1; }
  if [ ! -d "$ssh_home/.ssh" ]; then
    (umask 077; mkdir -p -- "$ssh_home/.ssh")
    changed=1
  fi
  if [ "$(stat -c %a -- "$ssh_home/.ssh")" != 700 ] || [ "$(stat -c %g -- "$ssh_home/.ssh")" != "$gid" ]; then
    chmod 700 -- "$ssh_home/.ssh"
    chown "$uid:$gid" -- "$ssh_home/.ssh"
    changed=1
  fi
  cd -P -- "$ssh_home/.ssh"
  exec {lock}< .
  flock -x "$lock"
  [ "$(stat -c '%d:%i' -- .)" = "$(stat -c '%d:%i' -- "$ssh_home/.ssh")" ] || { printf '%s\n' '[错误] SSH：.ssh 路径在写入前发生变化' >&2; exit 1; }
  [ ! -L authorized_keys ] && { [ ! -e authorized_keys ] || { [ -f authorized_keys ] && [ "$(stat -c %h -- authorized_keys)" = 1 ] && [ "$(stat -c %u -- authorized_keys)" = "$uid" ]; }; } || { printf '%s\n' '[错误] SSH：authorized_keys 不能是链接、异常文件或其他用户的文件' >&2; exit 1; }
  [ "$(printf '%s\n' "$key" | ssh-keygen -lf /dev/stdin -E sha256 | awk '{print $2}')" = "$fingerprint" ] || { printf '%s\n' '[错误] SSH：公钥指纹不匹配' >&2; exit 1; }
  if [ -f authorized_keys ]; then
    if [ "$(stat -c %a -- authorized_keys)" != 600 ] || [ "$(stat -c %g -- authorized_keys)" != "$gid" ]; then
      chmod 600 -- authorized_keys
      chown "$uid:$gid" -- authorized_keys
      changed=1
    fi
    # OpenSSH parses quoted options; keep restrictions on an existing key.
    existing=$(ssh-keygen -lf authorized_keys -E sha256 2>/dev/null || :)
    if printf '%s\n' "$existing" | awk -v fingerprint="$fingerprint" '$2 == fingerprint { found = 1 } END { exit !found }'; then
      if [ "$changed" = 1 ]; then
        printf '[已修改] SSH 文件权限 (%s)：%s；已有公钥保留\n' "$ssh_home/.ssh/authorized_keys" "$fingerprint"
      else
        printf '[未修改] SSH authorized_keys (%s)：%s 已存在\n' "$ssh_home/.ssh/authorized_keys" "$fingerprint"
      fi
      exit 0
    fi
  fi
  tmp=$(mktemp .authorized_keys.fast.XXXXXX)
  if [ -f authorized_keys ]; then
    cat -- authorized_keys > "$tmp"
    if [ -s authorized_keys ] && [ "$(tail -c 1 -- authorized_keys | od -An -tu1 | tr -d ' ')" != 10 ]; then
      printf '\n' >> "$tmp"
    fi
  fi
  printf '%s\n' "$key" >> "$tmp"
  chmod 600 -- "$tmp"
  chown "$uid:$gid" -- "$tmp"
  mv -fT -- "$tmp" authorized_keys
  tmp=''
  printf '[已修改] SSH authorized_keys (%s)：%s\n' "$ssh_home/.ssh/authorized_keys" "$fingerprint"
)

fast_ssh_authorize() {
  local ssh_user entry name password uid gid gecos ssh_home shell caller
  caller=$(id -u)
  if [ "$caller" = 0 ] && [ -z "${FAST_SSH_USER:-}${SUDO_USER:-}" ]; then
    printf '%s\n' '[跳过] SSH：直接以 root 运行时请通过 FAST_SSH_USER 指定现有非 root 目标账号，或从目标账号使用 sudo 运行'
    return
  fi
  ssh_user=${FAST_SSH_USER:-${SUDO_USER:-$(id -un)}}
  entry=$(getent -- passwd "$ssh_user") || { printf '[错误] SSH：目标账号不存在：%s\n' "$ssh_user" >&2; return 1; }
  [[ "$entry" != *$'\n'* ]] || { printf '%s\n' '[错误] SSH：目标账号查询不唯一' >&2; return 1; }
  IFS=: read -r name password uid gid gecos ssh_home shell <<< "$entry"
  [ "$name" = "$ssh_user" ] && [[ "$uid" =~ ^[0-9]+$ && "$gid" =~ ^[0-9]+$ ]] && (( 10#$uid != 0 )) || { printf '%s\n' '[错误] SSH：目标必须是有效的非 root 账号，请指定 FAST_SSH_USER' >&2; return 1; }
  [ "$caller" = 0 ] || [ "$caller" = "$uid" ] || { printf '%s\n' '[错误] SSH：只能为当前用户授权；其他账号需 sudo/root 执行' >&2; return 1; }
  for dependency in ssh-keygen flock; do
    command -v "$dependency" >/dev/null || { printf '[错误] SSH：缺少 %s\n' "$dependency" >&2; return 1; }
  done
  local key='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF0Wkx0mCzuekySkjVOZT8QvvFGIxmzjXkeodF9d80h1'
  local fingerprint='SHA256:eblfitnuQFVCzvdDBqVRiYOgqri42ieXSGd4ksWlB0Y'
  if [ "$caller" = 0 ]; then
    command -v runuser >/dev/null || { printf '%s\n' '[错误] SSH：缺少 runuser' >&2; return 1; }
    # Root drops privileges before touching the target user's SSH files.
    env -u BASH_ENV -u ENV runuser -u "$ssh_user" -- bash --noprofile --norc -c "$(declare -f fast_ssh_write); fast_ssh_write \"\$@\"" -- "$ssh_home" "$uid" "$gid" "$key" "$fingerprint"
  else
    fast_ssh_write "$ssh_home" "$uid" "$gid" "$key" "$fingerprint"
  fi
}

fast_ssh_authorize
printf '%s\n' '[完成] Ubuntu、npm 源与 SSH 公钥授权已检查；[未修改] 表示配置已一致，无需重复修改。'
