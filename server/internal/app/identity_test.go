package app

import "testing"

func TestNormalizePhone(t *testing.T) {
	tests := map[string]string{
		"13800138000":       "+8613800138000",
		"+86 138-0013-8000": "+8613800138000",
		"008613800138000":   "+8613800138000",
		"6505551234":        "6505551234",
	}
	for input, expected := range tests {
		actual, err := NormalizePhone(input)
		if err != nil {
			t.Fatalf("normalize %q: %v", input, err)
		}
		if actual != expected {
			t.Fatalf("normalize %q = %q, want %q", input, actual, expected)
		}
	}
}

func TestNormalizePhoneRejectsInvalidInput(t *testing.T) {
	_, err := NormalizePhone("not-a-phone")
	if err == nil {
		t.Fatal("invalid phone was accepted")
	}
}
