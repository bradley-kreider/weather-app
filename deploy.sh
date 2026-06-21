#!/usr/bin/env bash
set -e

if [ -z "$1" ]; then
  echo "Usage: ./deploy.sh \"your commit message\""
  exit 1
fi

git add -A
git commit -m "$1"
git push
