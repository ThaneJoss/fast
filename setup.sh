#Setup
. /etc/os-release

## archive.ubuntu.com
grep -qE '^URIs:.*[[:space:]]https://fast[.]thanejoss[.]com/archive[.]ubuntu[.]com/ubuntu/?([[:space:]]|$)' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null ||
cat >> /etc/apt/sources.list.d/ubuntu.sources <<EOF


Types: deb
URIs: https://fast.thanejoss.com/archive.ubuntu.com/ubuntu/
Suites: ${VERSION_CODENAME} ${VERSION_CODENAME}-updates ${VERSION_CODENAME}-backports
Components: main restricted universe multiverse
EOF

## security.ubuntu.com
grep -qE '^URIs:.*[[:space:]]https://fast[.]thanejoss[.]com/security[.]ubuntu[.]com/ubuntu/?([[:space:]]|$)' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null ||
cat >> /etc/apt/sources.list.d/ubuntu.sources <<EOF


Types: deb
URIs: https://fast.thanejoss.com/security.ubuntu.com/ubuntu/
Suites: ${VERSION_CODENAME}-security
Components: main restricted universe multiverse
EOF
