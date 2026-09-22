#Setup
# curl -fsSL https://fast.thanejoss.com/ | sudo bash
### fast.thanejoss.com Version __FAST_VERSION__

set -e
fast_version='__FAST_VERSION__'

## archive.ubuntu.com
fast_current=false
fast_block=
if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
  while IFS= read -r fast_line; do
    case "$fast_line" in
      '### fast.thanejoss.com'*' Version '*) fast_block=$fast_line ;;
      '### End Version '*)
        if [ "$fast_block" = "### fast.thanejoss.com/archive.ubuntu.com Version $fast_version" ] && [ "$fast_line" = "### End Version $fast_version" ]; then
          fast_current=true
          break
        fi
        fast_block=
        ;;
    esac
  done < /etc/apt/sources.list.d/ubuntu.sources
fi
if [ "$fast_current" = true ]; then
  printf '%s\n' '[未修改] Ubuntu 主源 (archive.ubuntu.com)：已是当前版本'
else
  if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
    sed -i -E '/^### fast[.]thanejoss[.]com\/archive[.]ubuntu[.]com Version /,/^### (fast[.]thanejoss[.]com|End Version )/{
      /^### fast[.]thanejoss[.]com/!d
      /^### fast[.]thanejoss[.]com\/archive[.]ubuntu[.]com Version /d
    }' /etc/apt/sources.list.d/ubuntu.sources
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
  . /etc/os-release
  cat >> /etc/apt/sources.list.d/ubuntu.sources <<EOF


### fast.thanejoss.com/archive.ubuntu.com Version $fast_version
Types: deb
URIs: https://fast.thanejoss.com/archive.ubuntu.com/ubuntu/
Suites: ${VERSION_CODENAME} ${VERSION_CODENAME}-updates ${VERSION_CODENAME}-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
### End Version $fast_version
EOF
  printf '%s\n' '[已修改] Ubuntu 主源 (archive.ubuntu.com)'
fi

## security.ubuntu.com
fast_current=false
fast_block=
if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
  while IFS= read -r fast_line; do
    case "$fast_line" in
      '### fast.thanejoss.com'*' Version '*) fast_block=$fast_line ;;
      '### End Version '*)
        if [ "$fast_block" = "### fast.thanejoss.com/security.ubuntu.com Version $fast_version" ] && [ "$fast_line" = "### End Version $fast_version" ]; then
          fast_current=true
          break
        fi
        fast_block=
        ;;
    esac
  done < /etc/apt/sources.list.d/ubuntu.sources
fi
if [ "$fast_current" = true ]; then
  printf '%s\n' '[未修改] Ubuntu 安全源 (security.ubuntu.com)：已是当前版本'
else
  if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
    sed -i -E '/^### fast[.]thanejoss[.]com\/security[.]ubuntu[.]com Version /,/^### (fast[.]thanejoss[.]com|End Version )/{
      /^### fast[.]thanejoss[.]com/!d
      /^### fast[.]thanejoss[.]com\/security[.]ubuntu[.]com Version /d
    }' /etc/apt/sources.list.d/ubuntu.sources
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
  . /etc/os-release
  cat >> /etc/apt/sources.list.d/ubuntu.sources <<EOF


### fast.thanejoss.com/security.ubuntu.com Version $fast_version
Types: deb
URIs: https://fast.thanejoss.com/security.ubuntu.com/ubuntu/
Suites: ${VERSION_CODENAME}-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
### End Version $fast_version
EOF
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
