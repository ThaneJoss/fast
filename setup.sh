#!/usr/bin/env bash
# setup
# archive.ubuntu.com / security.ubuntu.com
setup() {
  set -euo pipefail
  sed -Ei '/^URIs:/{:uri;s#([[:space:]])https?://((archive|security)\.ubuntu\.com)(/|[[:space:]]|$)#\1https://fast.thanejoss.com/\2\4#;t uri;}' /etc/apt/sources.list.d/ubuntu.sources
  apt-get update -qq
}

if (( EUID == 0 )); then
  setup
else
  sudo bash -c "$(declare -f setup); setup"
fi
