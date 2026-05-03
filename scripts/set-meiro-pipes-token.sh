#!/usr/bin/env sh
set -eu

root_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
secret_dir="$root_dir/.secrets"
secret_file="$secret_dir/meiro_pipes_token"

mkdir -p "$secret_dir"

printf "Paste Prism/Pipes token: " >&2
stty -echo
IFS= read -r token
stty echo
printf "\n" >&2

if [ -z "$token" ]; then
  printf "No token entered; leaving %s unchanged.\n" "$secret_file" >&2
  exit 1
fi

umask 077
printf "%s" "$token" > "$secret_file"
chmod 600 "$secret_file"
unset token

printf "Wrote token file: %s\n" "$secret_file" >&2
printf "Restarting API container...\n" >&2
cd "$root_dir"
docker compose up -d api
