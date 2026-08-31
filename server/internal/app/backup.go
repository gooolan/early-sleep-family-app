package app

import (
	"context"
	"errors"
	"fmt"
	"math"
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
		err := service.migrateWeekCalendar(&candidate, nightDate, location)
		if err != nil {
			return fmt.Errorf("%w: week calendar cannot be restored", ErrInvalidBackup)
		}
		err = service.ensureActiveWeek(&candidate, nightDate)
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
	err = validateBackupWeek(candidate.ActiveWeek.WeekStart, candidate.ActiveWeek.WeekEnd, candidate.ActiveWeek.WeekCalendar, candidate.ActiveWeek.Settings, candidate.Timezone)
	if err != nil {
		return err
	}
	err = validateActiveWeekBackup(candidate.ActiveWeek, candidate.Members, candidate.Timezone)
	if err != nil {
		return err
	}
	for _, archive := range candidate.Archives {
		err = validateBackupWeek(archive.WeekStart, archive.WeekEnd, archive.WeekCalendar, archive.SettingsSnapshot, candidate.Timezone)
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
	err = validatePriceBackup(candidate)
	if err != nil {
		return err
	}
	return nil
}

func validatePriceBackup(family Family) error {
	productIDs := make(map[string]struct{}, len(family.Products))
	productNames := make(map[string]struct{}, len(family.Products))
	for _, product := range family.Products {
		name, err := validateCatalogName(product.Name, 50)
		if err != nil || product.ID == "" || name != product.Name {
			return fmt.Errorf("%w: invalid price product", ErrInvalidBackup)
		}
		key := strings.ToLower(name)
		if _, exists := productIDs[product.ID]; exists {
			return fmt.Errorf("%w: duplicate price product id", ErrInvalidBackup)
		}
		if _, exists := productNames[key]; exists {
			return fmt.Errorf("%w: duplicate price product name", ErrInvalidBackup)
		}
		productIDs[product.ID] = struct{}{}
		productNames[key] = struct{}{}
	}

	storeIDs := make(map[string]struct{}, len(family.PriceStores))
	storeNames := make(map[string]struct{}, len(family.PriceStores))
	for _, priceStore := range family.PriceStores {
		name, err := validateCatalogName(priceStore.Name, 80)
		if err != nil || priceStore.ID == "" || name != priceStore.Name {
			return fmt.Errorf("%w: invalid price store", ErrInvalidBackup)
		}
		key := strings.ToLower(name)
		if _, exists := storeIDs[priceStore.ID]; exists {
			return fmt.Errorf("%w: duplicate price store id", ErrInvalidBackup)
		}
		if _, exists := storeNames[key]; exists {
			return fmt.Errorf("%w: duplicate price store name", ErrInvalidBackup)
		}
		storeIDs[priceStore.ID] = struct{}{}
		storeNames[key] = struct{}{}
	}

	recordIDs := make(map[string]struct{}, len(family.PriceRecords))
	for _, record := range family.PriceRecords {
		if record.ID == "" || record.PurchasedAt.IsZero() || record.CreatedAt.IsZero() || record.UpdatedAt.IsZero() {
			return fmt.Errorf("%w: invalid price record identity or time", ErrInvalidBackup)
		}
		if _, exists := recordIDs[record.ID]; exists {
			return fmt.Errorf("%w: duplicate price record id", ErrInvalidBackup)
		}
		if _, exists := productIDs[record.ProductID]; !exists {
			return fmt.Errorf("%w: price record product does not exist", ErrInvalidBackup)
		}
		if _, exists := storeIDs[record.StoreID]; !exists {
			return fmt.Errorf("%w: price record store does not exist", ErrInvalidBackup)
		}
		if _, exists := family.Members[record.MemberID]; !exists {
			return fmt.Errorf("%w: price record member does not exist", ErrInvalidBackup)
		}
		normalizedPrice, normalizedUnit, err := normalizePrice(record.EntryMode, record.UnitPrice, record.TotalPrice, record.Quantity, record.Unit)
		if err != nil || normalizedUnit != record.NormalizedUnit || math.Abs(normalizedPrice-record.NormalizedPrice) > 0.000001 {
			return fmt.Errorf("%w: invalid normalized price", ErrInvalidBackup)
		}
		if record.PriceKind != PriceKindRegular && record.PriceKind != PriceKindDiscount {
			return fmt.Errorf("%w: invalid price kind", ErrInvalidBackup)
		}
		if record.Quality != nil && (*record.Quality < 1 || *record.Quality > 5) {
			return fmt.Errorf("%w: invalid price quality", ErrInvalidBackup)
		}
		if record.ReferencePrice != nil {
			_, referenceUnit, exists := unitFactor(record.ReferenceUnit)
			if !positiveFinite(*record.ReferencePrice) || !exists || referenceUnit != record.NormalizedUnit {
				return fmt.Errorf("%w: invalid reference price", ErrInvalidBackup)
			}
		} else if record.ReferenceUnit != "" {
			return fmt.Errorf("%w: reference unit has no price", ErrInvalidBackup)
		}
		recordIDs[record.ID] = struct{}{}
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

func validateBackupWeek(weekStart string, weekEnd string, calendar string, settings Settings, timezone string) error {
	err := ValidateSettings(settings)
	if err != nil {
		return fmt.Errorf("%w: invalid settings", ErrInvalidBackup)
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return fmt.Errorf("%w: invalid timezone", ErrInvalidBackup)
	}
	var expectedStart string
	var expectedEnd string
	switch calendar {
	case CurrentWeekCalendar:
		expectedStart, expectedEnd, err = WeekRange(weekStart, location)
	case LegacyWeekCalendar:
		expectedStart, expectedEnd, err = legacyWeekRange(weekStart, location)
	case CutoverWeekCalendar:
		expectedStart, expectedEnd, err = legacyWeekRange(weekStart, location)
		if err == nil {
			expectedEnd, err = addDate(expectedEnd, -1, location)
		}
	default:
		return fmt.Errorf("%w: invalid week calendar", ErrInvalidBackup)
	}
	if err != nil {
		return fmt.Errorf("%w: invalid week", ErrInvalidBackup)
	}
	if expectedStart != weekStart || expectedEnd != weekEnd {
		return fmt.Errorf("%w: invalid week range", ErrInvalidBackup)
	}
	return nil
}
