#!/usr/bin/env bash

set -euo pipefail

repository_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mode=${1:-full}
mobile_directory=${repository_directory}/mobile
web_directory=${mobile_directory}/dist
apk_source=${mobile_directory}/android/app/build/outputs/apk/release/app-release.apk
update_directory=${repository_directory}/updates
web_update_directory=${update_directory}/web
android_update_directory=${update_directory}/android

web_version=$(node -p "JSON.parse(require('fs').readFileSync('${mobile_directory}/package.json', 'utf8')).version")

if [[ ${mode} != full && ${mode} != web-only ]]; then
  echo "usage: $0 [full|web-only]" >&2
  exit 1
fi
if [[ ! ${web_version} =~ ^[0-9]+(\.[0-9]+)+$ ]]; then
  echo "web update version must contain only numeric dot-separated parts: ${web_version}" >&2
  exit 1
fi
if [[ ! -f ${web_directory}/index.html ]]; then
  echo "mobile web build is missing: ${web_directory}/index.html" >&2
  exit 1
fi

mkdir -p "${web_update_directory}" "${android_update_directory}"
web_bundle=${web_update_directory}/web-${web_version}.zip
rm -f "${web_bundle}"

(
  cd "${web_directory}"
  zip -q -r "${web_bundle}" . -x '.*' '*/.*'
)

web_sha256=$(shasum -a 256 "${web_bundle}" | awk '{print $1}')
published_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [[ ${mode} == full ]]; then
  version_code=$(awk '$1 == "versionCode" { print $2; exit }' "${mobile_directory}/android/app/build.gradle")
  native_version=$(awk '$1 == "versionName" { gsub(/\"/, "", $2); print $2; exit }' "${mobile_directory}/android/app/build.gradle")
  if [[ ! ${native_version} =~ ^[0-9]+(\.[0-9]+)+$ || ! ${version_code} =~ ^[0-9]+$ ]]; then
    echo "cannot determine Android versionName or versionCode" >&2
    exit 1
  fi
  if [[ ! -f ${apk_source} ]]; then
    echo "release APK is missing: ${apk_source}" >&2
    exit 1
  fi

  apk_target=${android_update_directory}/early-sleep-${native_version}.apk
  cp "${apk_source}" "${apk_target}"
  apk_sha256=$(shasum -a 256 "${apk_target}" | awk '{print $1}')
  minimum_native_version_code=${version_code}
  android_version_code=${version_code}
  android_version_name=${native_version}
  android_url=/updates/android/early-sleep-${native_version}.apk
  android_sha256=${apk_sha256}
else
  if [[ ! -f ${update_directory}/manifest.json ]]; then
    echo "existing update manifest is required for a web-only release" >&2
    exit 1
  fi
  minimum_native_version_code=$(node -p "JSON.parse(require('fs').readFileSync('${update_directory}/manifest.json', 'utf8')).minimumNativeVersionCode")
  android_version_code=$(node -p "JSON.parse(require('fs').readFileSync('${update_directory}/manifest.json', 'utf8')).androidVersionCode")
  android_version_name=$(node -p "JSON.parse(require('fs').readFileSync('${update_directory}/manifest.json', 'utf8')).androidVersionName")
  android_url=$(node -p "JSON.parse(require('fs').readFileSync('${update_directory}/manifest.json', 'utf8')).androidUrl")
  android_sha256=$(node -p "JSON.parse(require('fs').readFileSync('${update_directory}/manifest.json', 'utf8')).androidSha256")
fi

temporary_manifest=$(mktemp "${update_directory}/manifest.json.tmp.XXXXXX")
cleanup() {
  rm -f "${temporary_manifest}"
}
trap cleanup EXIT

printf '%s\n' \
  '{' \
  "  \"webVersion\": \"${web_version}\"," \
  "  \"bundleUrl\": \"/updates/web/web-${web_version}.zip\"," \
  "  \"sha256\": \"${web_sha256}\"," \
  "  \"minimumNativeVersionCode\": ${minimum_native_version_code}," \
  "  \"androidVersionCode\": ${android_version_code}," \
  "  \"androidVersionName\": \"${android_version_name}\"," \
  "  \"androidUrl\": \"${android_url}\"," \
  "  \"androidSha256\": \"${android_sha256}\"," \
  "  \"publishedAt\": \"${published_at}\"" \
  '}' > "${temporary_manifest}"

mv "${temporary_manifest}" "${update_directory}/manifest.json"
trap - EXIT

echo "packaged web update ${web_bundle}"
if [[ ${mode} == full ]]; then
  echo "packaged Android update ${apk_target}"
fi
