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

printf '%s\n' '[完成] Ubuntu 与 npm 源配置已检查；[未修改] 表示配置已一致，无需重复修改。'
