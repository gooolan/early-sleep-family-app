package app

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

func randomID(prefix string, size int) (string, error) {
	buffer := make([]byte, size)
	_, err := rand.Read(buffer)
	if err != nil {
		return "", fmt.Errorf("generate random id: %w", err)
	}
	encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buffer)
	return prefix + strings.ToLower(encoded), nil
}

func randomSecret(size int) (string, error) {
	buffer := make([]byte, size)
	_, err := rand.Read(buffer)
	if err != nil {
		return "", fmt.Errorf("generate random secret: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func hashValue(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func buildMemberToken(familyID string, memberID string, secret string) string {
	return familyID + "." + memberID + "." + secret
}

func parseMemberToken(token string) (string, string, string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", "", "", errors.New("invalid member token")
	}
	return parts[0], parts[1], parts[2], nil
}
