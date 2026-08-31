package app

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPing(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHTTPHandler(NewService(store), slog.New(slog.NewTextHandler(io.Discard, nil)), t.TempDir())
	request := httptest.NewRequest("GET", "/ping", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("status = %d, want 200", response.Code)
	}
}

func TestPhoneIdentityHTTPFlow(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHTTPHandler(NewService(store), slog.New(slog.NewTextHandler(io.Discard, nil)), t.TempDir())

	request := httptest.NewRequest("POST", "/api/v1/families", bytes.NewBufferString(`{"familyName":"HTTP 家庭","nickname":"甲","phone":"13800138006","timezone":"Asia/Shanghai"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 201 {
		t.Fatalf("create status = %d, body = %s", response.Code, response.Body.String())
	}
	if bytes.Contains(response.Body.Bytes(), []byte(`"weeklyArchives":null`)) {
		t.Fatal("empty weekly archives were encoded as null")
	}
	if bytes.Contains(response.Body.Bytes(), []byte(`"pendingChanges":null`)) {
		t.Fatal("empty pending changes were encoded as null")
	}

	request = httptest.NewRequest("POST", "/api/v1/identity/check", bytes.NewBufferString(`{"phone":"+86 13800138006"}`))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("identity status = %d, body = %s", response.Code, response.Body.String())
	}
	var identityEnvelope struct {
		Data IdentityStatus `json:"data"`
	}
	err = json.NewDecoder(response.Body).Decode(&identityEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	if !identityEnvelope.Data.Exists || identityEnvelope.Data.Phone != "+8613800138006" {
		t.Fatalf("identity = %+v", identityEnvelope.Data)
	}

	request = httptest.NewRequest("POST", "/api/v1/sessions", bytes.NewBufferString(`{"phone":"13800138006"}`))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("login status = %d, body = %s", response.Code, response.Body.String())
	}
	var sessionEnvelope struct {
		Data FamilySession `json:"data"`
	}
	err = json.NewDecoder(response.Body).Decode(&sessionEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	if sessionEnvelope.Data.Token == "" || sessionEnvelope.Data.Family.CurrentMember.Phone != "+8613800138006" {
		t.Fatalf("session = %+v", sessionEnvelope.Data)
	}

	request = httptest.NewRequest("PATCH", "/api/v1/members/me", bytes.NewBufferString(`{"name":"新称呼"}`))
	request.Header.Set("Authorization", "Bearer "+sessionEnvelope.Data.Token)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 200 || !bytes.Contains(response.Body.Bytes(), []byte(`"name":"新称呼"`)) {
		t.Fatalf("profile status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestUpdateFilesHTTP(t *testing.T) {
	updateDirectory := t.TempDir()
	err := os.MkdirAll(filepath.Join(updateDirectory, "web"), 0o755)
	if err != nil {
		t.Fatal(err)
	}
	err = os.MkdirAll(filepath.Join(updateDirectory, "android"), 0o755)
	if err != nil {
		t.Fatal(err)
	}
	err = os.WriteFile(filepath.Join(updateDirectory, "manifest.json"), []byte(`{"webVersion":"1.2.4"}`), 0o644)
	if err != nil {
		t.Fatal(err)
	}
	err = os.WriteFile(filepath.Join(updateDirectory, "web", "web-1.2.4.zip"), []byte("bundle-content"), 0o644)
	if err != nil {
		t.Fatal(err)
	}
	err = os.WriteFile(filepath.Join(updateDirectory, "android", "early-sleep-1.3.0.apk"), []byte("apk-content"), 0o644)
	if err != nil {
		t.Fatal(err)
	}
	err = os.WriteFile(filepath.Join(updateDirectory, ".secret.json"), []byte(`{"secret":true}`), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHTTPHandler(NewService(store), slog.New(slog.NewTextHandler(io.Discard, nil)), updateDirectory)

	request := httptest.NewRequest(http.MethodGet, "/updates/manifest.json", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("manifest status = %d, body = %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/json; charset=utf-8" {
		t.Fatalf("manifest content type = %q", contentType)
	}
	if cacheControl := response.Header().Get("Cache-Control"); cacheControl != "no-store" {
		t.Fatalf("manifest cache control = %q", cacheControl)
	}

	request = httptest.NewRequest(http.MethodGet, "/updates/web/web-1.2.4.zip", nil)
	request.Header.Set("Range", "bytes=0-5")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "bundle" {
		t.Fatalf("bundle status = %d, body = %q", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/zip" {
		t.Fatalf("bundle content type = %q", contentType)
	}
	if cacheControl := response.Header().Get("Cache-Control"); cacheControl != "public, max-age=31536000, immutable" {
		t.Fatalf("bundle cache control = %q", cacheControl)
	}

	request = httptest.NewRequest(http.MethodGet, "/updates/android/early-sleep-1.3.0.apk", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("APK status = %d, body = %s", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/vnd.android.package-archive" {
		t.Fatalf("APK content type = %q", contentType)
	}
	if disposition := response.Header().Get("Content-Disposition"); disposition != `attachment; filename="early-sleep-1.3.0.apk"` {
		t.Fatalf("APK content disposition = %q", disposition)
	}

	for _, requestPath := range []string{"/updates/", "/updates/web/", "/updates/.secret.json", "/updates/readme.txt"} {
		request = httptest.NewRequest(http.MethodGet, requestPath, nil)
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("path %q status = %d, want 404", requestPath, response.Code)
		}
	}
}
