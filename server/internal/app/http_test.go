package app

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
)

func TestPing(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHTTPHandler(NewService(store), slog.New(slog.NewTextHandler(io.Discard, nil)))
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
	handler := NewHTTPHandler(NewService(store), slog.New(slog.NewTextHandler(io.Discard, nil)))

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
}
