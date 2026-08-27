package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrInvalidBackup = errors.New("invalid family backup")

const currentBackupFormatVersion = 1

func (service *Service) ExportFamily(ctx context.Context, token string) (FamilyBackup, error) {
	family, _, err := service.authenticate(ctx, token)
	if err != nil {
		return FamilyBackup{}, err
	}
	for memberID, member := range family.Members {
		member.TokenHash = ""
		family.Members[memberID] = member
	}
	family.JoinCodeHash = ""
	return FamilyBackup{
		FormatVersion: currentBackupFormatVersion,
		ExportedAt:    service.now().UTC(),
		Family:        family,
	}, nil
}

func (service *Service) RestoreFamily(ctx context.Context, token string, backup FamilyBackup) (FamilyView, error) {
	family, member, err := service.authenticate(ctx, token)
	if err != nil {
		return FamilyView{}, err
	}
	if member.Role != RoleOwner {
		return FamilyView{}, ErrUnauthorized
	}
	candidate := normalizeFamily(backup.Family)
	err = validateFamilyBackup(backup.FormatVersion, family, candidate)
	if err != nil {
		return FamilyView{}, err
	}
	location, err := time.LoadLocation(candidate.Timezone)
	if err != nil {
		return FamilyView{}, fmt.Errorf("%w: invalid timezone", ErrInvalidBackup)
	}
	nightDate := NightDate(service.now().In(location), candidate.ActiveWeek.Settings)

	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		for memberID, currentMember := range current.Members {
			restoredMember, exists := candidate.Members[memberID]
			if !exists {
				return fmt.Errorf("%w: member set does not match", ErrInvalidBackup)
			}
			restoredMember.ID = currentMember.ID
			restoredMember.Role = currentMember.Role
			restoredMember.Phone = currentMember.Phone
			restoredMember.PhoneVerifiedAt = currentMember.PhoneVerifiedAt
			restoredMember.TokenHash = currentMember.TokenHash
			candidate.Members[memberID] = restoredMember
		}
		candidate.Revision = current.Revision
		candidate.JoinCodeHash = hashValue(strings.ToLower(candidate.JoinCode))
		err := service.ensureActiveWeek(&candidate, nightDate)
		if err != nil {
			return fmt.Errorf("%w: active week cannot be restored", ErrInvalidBackup)
		}
		*current = candidate
		return nil
	})
	if err != nil {
		return FamilyView{}, err
	}
	return service.buildFamilyView(family, member.ID)
}

func validateFamilyBackup(formatVersion int, current Family, candidate Family) error {
	if formatVersion != currentBackupFormatVersion {
		return fmt.Errorf("%w: unsupported format version", ErrInvalidBackup)
	}
	if candidate.ID != current.ID {
		return fmt.Errorf("%w: family id does not match", ErrInvalidBackup)
	}
	if strings.TrimSpace(candidate.Name) == "" || strings.TrimSpace(candidate.JoinCode) == "" {
		return fmt.Errorf("%w: family name or join code is missing", ErrInvalidBackup)
	}
	_, err := time.LoadLocation(candidate.Timezone)
	if err != nil {
		return fmt.Errorf("%w: invalid timezone", ErrInvalidBackup)
	}
	if len(candidate.Members) != len(current.Members) || len(candidate.Members) == 0 || len(candidate.Members) > 2 {
		return fmt.Errorf("%w: member count does not match", ErrInvalidBackup)
	}
	for memberID, member := range candidate.Members {
		if member.ID != memberID || strings.TrimSpace(member.Name) == "" {
			return fmt.Errorf("%w: invalid member", ErrInvalidBackup)
		}
		if _, exists := current.Members[memberID]; !exists {
			return fmt.Errorf("%w: member set does not match", ErrInvalidBackup)
		}
	}
	err = validateBackupWeek(candidate.ActiveWeek.WeekStart, candidate.ActiveWeek.WeekEnd, candidate.ActiveWeek.Settings, candidate.Timezone)
	if err != nil {
		return err
	}
	err = validateActiveWeekBackup(candidate.ActiveWeek, candidate.Members, candidate.Timezone)
	if err != nil {
		return err
	}
	for _, archive := range candidate.Archives {
		err = validateBackupWeek(archive.WeekStart, archive.WeekEnd, archive.SettingsSnapshot, candidate.Timezone)
		if err != nil {
			return err
		}
		err = validateArchiveBackup(archive, candidate.Members, candidate.Timezone)
		if err != nil {
			return err
		}
	}
	err = validatePendingBackup(candidate.Pending, candidate.PendingExemptions, candidate.ActiveWeek, candidate.Members, candidate.Timezone)
	if err != nil {
		return err
	}
	return nil
}

func validateActiveWeekBackup(active ActiveWeek, members map[string]Member, timezone string) error {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return fmt.Errorf("%w: invalid timezone", ErrInvalidBackup)
	}
	for date, checkins := range active.Checkins {
		err = validateBackupDate(date, active.WeekStart, active.WeekEnd, location)
		if err != nil {
			return err
		}
		for memberID := range checkins {
			if _, exists := members[memberID]; !exists {
				return fmt.Errorf("%w: checkin member does not exist", ErrInvalidBackup)
			}
		}
	}
	for date, exemptions := range active.Exemptions {
		err = validateBackupDate(date, active.WeekStart, active.WeekEnd, location)
		if err != nil {
			return err
		}
		for memberID, exemption := range exemptions {
			if _, exists := members[memberID]; !exists {
				return fmt.Errorf("%w: exemption member does not exist", ErrInvalidBackup)
			}
			if exemption.Date != date || exemption.MemberID != memberID {
				return fmt.Errorf("%w: exemption identity does not match", ErrInvalidBackup)
			}
		}
	}
	_, err = CalculateWeek(active, len(members), location)
	if err != nil {
		return fmt.Errorf("%w: invalid active week data", ErrInvalidBackup)
	}
	return nil
}

func validateArchiveBackup(archive WeeklyArchive, members map[string]Member, timezone string) error {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return fmt.Errorf("%w: invalid timezone", ErrInvalidBackup)
	}
	for _, day := range archive.DailySnapshot {
		err = validateBackupDate(day.Date, archive.WeekStart, archive.WeekEnd, location)
		if err != nil {
			return err
		}
		for memberID, result := range day.Members {
			if _, exists := members[memberID]; !exists {
				return fmt.Errorf("%w: archived member does not exist", ErrInvalidBackup)
			}
			if !result.Exempt {
				err = validateTime(result.Time)
				if err != nil {
					return fmt.Errorf("%w: archived time is invalid", ErrInvalidBackup)
				}
			}
		}
	}
	for memberID := range archive.Summary.Members {
		if _, exists := members[memberID]; !exists {
			return fmt.Errorf("%w: archived summary member does not exist", ErrInvalidBackup)
		}
	}
	for _, exemption := range archive.ExemptionsSnapshot {
		err = validateBackupDate(exemption.Date, archive.WeekStart, archive.WeekEnd, location)
		if err != nil {
			return err
		}
		if _, exists := members[exemption.MemberID]; !exists {
			return fmt.Errorf("%w: archived exemption member does not exist", ErrInvalidBackup)
		}
	}
	return nil
}

func validatePendingBackup(changes []CheckinChange, exemptions []ExemptionChange, active ActiveWeek, members map[string]Member, timezone string) error {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return fmt.Errorf("%w: invalid timezone", ErrInvalidBackup)
	}
	for _, change := range changes {
		if change.ID == "" || change.WeekStart != active.WeekStart || change.MemberID != change.RequestedBy {
			return fmt.Errorf("%w: invalid pending checkin change", ErrInvalidBackup)
		}
		if _, exists := members[change.MemberID]; !exists {
			return fmt.Errorf("%w: pending checkin member does not exist", ErrInvalidBackup)
		}
		err = validateBackupDate(change.Date, active.WeekStart, active.WeekEnd, location)
		if err != nil {
			return err
		}
		switch change.Kind {
		case CheckinChangeUpsert:
			err = validateTime(change.ProposedTime)
			if err != nil {
				return fmt.Errorf("%w: pending checkin time is invalid", ErrInvalidBackup)
			}
		case CheckinChangeDelete:
			if change.OriginalTime == "" {
				return fmt.Errorf("%w: pending deletion has no original time", ErrInvalidBackup)
			}
		default:
			return fmt.Errorf("%w: pending checkin kind is invalid", ErrInvalidBackup)
		}
	}
	for _, exemption := range exemptions {
		if exemption.ID == "" || exemption.WeekStart != active.WeekStart || exemption.MemberID != exemption.RequestedBy {
			return fmt.Errorf("%w: invalid pending exemption", ErrInvalidBackup)
		}
		if _, exists := members[exemption.MemberID]; !exists {
			return fmt.Errorf("%w: pending exemption member does not exist", ErrInvalidBackup)
		}
		err = validateBackupDate(exemption.Date, active.WeekStart, active.WeekEnd, location)
		if err != nil {
			return err
		}
	}
	return nil
}

func validateBackupDate(date string, weekStart string, weekEnd string, location *time.Location) error {
	parsed, err := time.ParseInLocation(time.DateOnly, date, location)
	if err != nil {
		return fmt.Errorf("%w: invalid date", ErrInvalidBackup)
	}
	canonical := parsed.Format(time.DateOnly)
	if canonical < weekStart || canonical > weekEnd {
		return fmt.Errorf("%w: date is outside week", ErrInvalidBackup)
	}
	return nil
}

func validateBackupWeek(weekStart string, weekEnd string, settings Settings, timezone string) error {
	err := ValidateSettings(settings)
	if err != nil {
		return fmt.Errorf("%w: invalid settings", ErrInvalidBackup)
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return fmt.Errorf("%w: invalid timezone", ErrInvalidBackup)
	}
	expectedStart, expectedEnd, err := WeekRange(weekStart, location)
	if err != nil {
		return fmt.Errorf("%w: invalid week", ErrInvalidBackup)
	}
	if expectedStart != weekStart || expectedEnd != weekEnd {
		return fmt.Errorf("%w: invalid week range", ErrInvalidBackup)
	}
	return nil
}
