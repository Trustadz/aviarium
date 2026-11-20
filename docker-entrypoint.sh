#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  # Compose creates a missing bind directory as root on standard Docker hosts.
  if [ "$(stat -c %u /backup)" -eq 0 ] && [ -z "$(find /backup -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    chown node:node /backup
    chmod 0700 /backup
  fi
  exec gosu node "$@"
fi

exec "$@"
