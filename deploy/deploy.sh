#!/usr/bin/env bash
# Pull the latest code, build the site, and publish it to the web root.
# Runs on the droplet, both by hand and from the daily cron job.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/keepsharpening}"
WEB_ROOT="${WEB_ROOT:-/var/www/keepsharpening}"
BRANCH="${BRANCH:-main}"

# Don't let a manual deploy and the cron job run at the same time.
exec 9>"/tmp/keepsharpening-deploy.lock"
flock -n 9 || { echo "Another deploy is running; exiting."; exit 1; }

echo "== $(date -u '+%Y-%m-%d %H:%M:%S') UTC: deploying $BRANCH"
cd "$REPO_DIR"

git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git merge --ff-only --quiet "origin/$BRANCH"

# Reinstall dependencies only when the lockfile has changed.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm ci --no-audit --no-fund
  touch node_modules
fi

# Build from scratch so deleted posts disappear. If the build fails,
# set -e stops here and the live site is left untouched.
rm -rf _site
npm run --silent build -- --quiet

rsync -a --delete _site/ "$WEB_ROOT/"
echo "== published $(git rev-parse --short HEAD) to $WEB_ROOT"
