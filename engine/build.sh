#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
npm run build
