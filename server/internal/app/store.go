package app

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var (
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
	ErrFamilyFull   = errors.New("family already has two members")
)

type Store struct {
	directory string
	mu        sync.Mutex
}

func NewStore(directory string) (*Store, error) {
	err := os.MkdirAll(directory, 0o700)
	if err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	return &Store{directory: directory}, nil
}

func (store *Store) Create(ctx context.Context, family Family) error {
	store.mu.Lock()
	defer store.mu.Unlock()

	err := ctx.Err()
	if err != nil {
		return err
	}

	path, err := store.familyPath(family.ID)
	if err != nil {
		return err
	}
	_, err = os.Stat(path)
	if err == nil {
		return fmt.Errorf("family already exists: %w", ErrInvalidInput)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("check family file: %w", err)
	}
	err = store.ensureUniquePhones(family)
	if err != nil {
		return err
	}

	err = store.writeFamily(path, family)
	if err != nil {
		return err
	}
	return nil
}

func (store *Store) Get(ctx context.Context, familyID string) (Family, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	err := ctx.Err()
	if err != nil {
		return Family{}, err
	}
	return store.readFamilyByID(familyID)
}

func (store *Store) Update(ctx context.Context, familyID string, update func(*Family) error) (Family, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	err := ctx.Err()
	if err != nil {
		return Family{}, err
	}

	family, err := store.readFamilyByID(familyID)
	if err != nil {
		return Family{}, err
	}
	err = update(&family)
	if err != nil {
		return Family{}, err
	}
	if family.Version < 6 {
		family.Version = 6
	}
	err = store.ensureUniquePhones(family)
	if err != nil {
		return Family{}, err
	}
	family.Revision++

	path, err := store.familyPath(familyID)
	if err != nil {
		return Family{}, err
	}
	err = store.writeFamily(path, family)
	if err != nil {
		return Family{}, err
	}
	return family, nil
}

func (store *Store) FindByJoinCode(ctx context.Context, joinCodeHash string) (Family, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	err := ctx.Err()
	if err != nil {
		return Family{}, err
	}

	entries, err := os.ReadDir(store.directory)
	if err != nil {
		return Family{}, fmt.Errorf("read data directory: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		path := filepath.Join(store.directory, entry.Name())
		family, err := store.readFamily(path)
		if err != nil {
			return Family{}, err
		}
		if constantEqual(family.JoinCodeHash, joinCodeHash) {
			return family, nil
		}
	}
	return Family{}, ErrNotFound
}

func (store *Store) FindMemberByPhone(ctx context.Context, phone string) (Family, Member, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	err := ctx.Err()
	if err != nil {
		return Family{}, Member{}, err
	}
	return store.findMemberByPhone(phone)
}

func (store *Store) findMemberByPhone(phone string) (Family, Member, error) {
	entries, err := os.ReadDir(store.directory)
	if err != nil {
		return Family{}, Member{}, fmt.Errorf("read data directory: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		path := filepath.Join(store.directory, entry.Name())
		family, err := store.readFamily(path)
		if err != nil {
			return Family{}, Member{}, err
		}
		for _, member := range family.Members {
			if member.Phone == phone {
				return family, member, nil
			}
		}
	}
	return Family{}, Member{}, ErrNotFound
}

func (store *Store) ensureUniquePhones(candidate Family) error {
	phones := make(map[string]struct{}, len(candidate.Members))
	for _, member := range candidate.Members {
		if member.Phone == "" {
			continue
		}
		if _, exists := phones[member.Phone]; exists {
			return ErrPhoneExists
		}
		phones[member.Phone] = struct{}{}
	}

	entries, err := os.ReadDir(store.directory)
	if err != nil {
		return fmt.Errorf("read data directory: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(store.directory, entry.Name())
		existing, err := store.readFamily(path)
		if err != nil {
			return err
		}
		if existing.ID == candidate.ID {
			continue
		}
		for _, member := range existing.Members {
			if _, exists := phones[member.Phone]; exists && member.Phone != "" {
				return ErrPhoneExists
			}
		}
	}
	return nil
}

func (store *Store) familyPath(familyID string) (string, error) {
	if familyID == "" || strings.ContainsAny(familyID, `/\\.`) {
		return "", fmt.Errorf("%w: invalid family id", ErrInvalidInput)
	}
	return filepath.Join(store.directory, familyID+".json"), nil
}

func (store *Store) readFamilyByID(familyID string) (Family, error) {
	path, err := store.familyPath(familyID)
	if err != nil {
		return Family{}, err
	}
	return store.readFamily(path)
}

func (store *Store) readFamily(path string) (Family, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Family{}, ErrNotFound
	}
	if err != nil {
		return Family{}, fmt.Errorf("read family file: %w", err)
	}

	var family Family
	err = json.Unmarshal(data, &family)
	if err != nil {
		return Family{}, fmt.Errorf("decode family file: %w", err)
	}
	family = normalizeFamily(family)
	return family, nil
}

func normalizeFamily(family Family) Family {
	family.ActiveWeek.Settings = NormalizeSettings(family.ActiveWeek.Settings)
	if family.ActiveWeek.RewardRuleVersion == "" {
		family.ActiveWeek.RewardRuleVersion = CurrentRewardRuleVersion
	}
	if family.ActiveWeek.Checkins == nil {
		family.ActiveWeek.Checkins = make(map[string]map[string]Checkin)
	}
	if family.ActiveWeek.Exemptions == nil {
		family.ActiveWeek.Exemptions = make(map[string]map[string]Exemption)
	}
	if family.Pending == nil {
		family.Pending = make([]CheckinChange, 0)
	}
	if family.PendingExemptions == nil {
		family.PendingExemptions = make([]ExemptionChange, 0)
	}
	if family.RewardReviewStartedAt.IsZero() {
		family.RewardReviewStartedAt = family.CreatedAt
	}
	if family.Archives == nil {
		family.Archives = make([]WeeklyArchive, 0)
	}
	for index := range family.Archives {
		archive := &family.Archives[index]
		archive.SettingsSnapshot = NormalizeSettings(archive.SettingsSnapshot)
		if archive.RewardRuleVersion == "" {
			archive.RewardRuleVersion = CurrentRewardRuleVersion
		}
	}
	family.Version = 6
	return family
}

func (store *Store) writeFamily(path string, family Family) error {
	data, err := json.MarshalIndent(family, "", "  ")
	if err != nil {
		return fmt.Errorf("encode family file: %w", err)
	}

	temporary := path + ".tmp"
	err = os.WriteFile(temporary, data, 0o600)
	if err != nil {
		return fmt.Errorf("write temporary family file: %w", err)
	}

	_, err = os.Stat(path)
	if err == nil {
		err = copyFile(path, path+".bak")
		if err != nil {
			return fmt.Errorf("backup family file: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("check existing family file: %w", err)
	}

	err = os.Rename(temporary, path)
	if err != nil {
		return fmt.Errorf("replace family file: %w", err)
	}
	return nil
}

func copyFile(source string, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()

	output, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer output.Close()

	_, err = io.Copy(output, input)
	if err != nil {
		return err
	}
	err = output.Sync()
	if err != nil {
		return err
	}
	return nil
}

func constantEqual(left string, right string) bool {
	if len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}
