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
[ "$fast_current" = true ] || {
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
}

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
[ "$fast_current" = true ] || {
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
}
