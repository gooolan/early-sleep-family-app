.PHONY: test server-linux mobile android-sync android-release package-web-update package-updates checksums release

test:
	cd server && GOWORK=off go test ./...

server-linux:
	mkdir -p dist/server
	cd server && GOWORK=off CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o ../dist/server/early-sleep-server-linux-amd64 ./cmd/server
	cd server && GOWORK=off CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o ../dist/server/early-sleep-server-linux-arm64 ./cmd/server

mobile:
	cd mobile && pnpm build

android-sync:
	cd mobile && pnpm build && pnpm exec cap sync android

android-release:
	cd mobile && pnpm run android:release
	mkdir -p dist/android
	cp mobile/android/app/build/outputs/apk/release/app-release.apk dist/android/early-sleep-family-release.apk

package-updates: android-release
	./deploy/package-updates.sh

package-web-update: mobile
	./deploy/package-updates.sh web-only

checksums:
	cd dist && shasum -a 256 android/early-sleep-family-release.apk server/early-sleep-server-linux-amd64 server/early-sleep-server-linux-arm64 > SHA256SUMS

release: test server-linux package-updates checksums
