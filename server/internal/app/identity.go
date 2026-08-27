package app

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
)

var ErrPhoneExists = errors.New("phone already exists")

func NormalizePhone(value string) (string, error) {
	value = strings.TrimSpace(value)
	value = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(value)
	if strings.HasPrefix(value, "0086") {
		value = "+86" + strings.TrimPrefix(value, "0086")
	}
	if len(value) == 11 && strings.HasPrefix(value, "1") && onlyDigits(value) {
		value = "+86" + value
	}

	digits := value
	if strings.HasPrefix(value, "+") {
		digits = strings.TrimPrefix(value, "+")
	}
	if len(digits) < 6 || len(digits) > 15 || !onlyDigits(digits) {
		return "", fmt.Errorf("%w: phone must contain 6 to 15 digits", ErrInvalidInput)
	}
	return value, nil
}

func onlyDigits(value string) bool {
	for _, character := range value {
		if !unicode.IsDigit(character) || character > unicode.MaxASCII {
			return false
		}
	}
	return true
}
