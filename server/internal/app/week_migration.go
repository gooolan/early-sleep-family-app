package app

import (
	"context"
	"fmt"
	"time"
)

func (service *Service) ensureCurrentWeekCalendar(ctx context.Context, family Family) (Family, error) {
	if family.Version >= CurrentFamilyVersion {
		return family, nil
	}
	location, err := time.LoadLocation(family.Timezone)
	if err != nil {
		return Family{}, err
	}
	nightDate := NightDate(service.now().In(location), family.ActiveWeek.Settings)
	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		return service.migrateWeekCalendar(current, nightDate, location)
	})
	if err != nil {
		return Family{}, err
	}
	return family, nil
}

func (service *Service) migrateWeekCalendar(family *Family, targetDate string, location *time.Location) error {
	if family.Version >= CurrentFamilyVersion {
		return nil
	}
	weekStart, weekEnd, err := WeekRange(targetDate, location)
	if err != nil {
		return err
	}
	if family.ActiveWeek.WeekCalendar == CurrentWeekCalendar && family.ActiveWeek.WeekStart == weekStart {
		family.Version = CurrentFamilyVersion
		return nil
	}

	next := ActiveWeek{
		WeekStart:         weekStart,
		WeekEnd:           weekEnd,
		WeekCalendar:      CurrentWeekCalendar,
		RewardRuleVersion: CurrentRewardRuleVersion,
		Settings:          cloneSettings(family.ActiveWeek.Settings),
		Checkins:          make(map[string]map[string]Checkin),
		Exemptions:        make(map[string]map[string]Exemption),
	}

	archives := make([]WeeklyArchive, 0, len(family.Archives)+1)
	for _, archive := range family.Archives {
		migrated, keep, err := migrateArchiveBoundary(&next, archive, weekStart, weekEnd, len(family.Members), location)
		if err != nil {
			return err
		}
		if keep {
			archives = append(archives, migrated)
		}
	}

	remainder, err := migrateActiveBoundary(&next, family.ActiveWeek, weekStart, location)
	if err != nil {
		return err
	}
	if hasCheckins(remainder) {
		archive, err := service.archiveWeek(remainder, len(family.Members), location)
		if err != nil {
			return err
		}
		archives = append(archives, archive)
	}

	pending := make([]CheckinChange, 0, len(family.Pending))
	for _, change := range family.Pending {
		if change.Date < weekStart || change.Date > weekEnd {
			continue
		}
		change.WeekStart = weekStart
		pending = append(pending, change)
	}
	pendingExemptions := make([]ExemptionChange, 0, len(family.PendingExemptions))
	for _, change := range family.PendingExemptions {
		if change.Date < weekStart || change.Date > weekEnd {
			continue
		}
		change.WeekStart = weekStart
		pendingExemptions = append(pendingExemptions, change)
	}

	family.ActiveWeek = next
	family.Archives = archives
	family.Pending = pending
	family.PendingExemptions = pendingExemptions
	family.Version = CurrentFamilyVersion
	return nil
}

func migrateArchiveBoundary(next *ActiveWeek, archive WeeklyArchive, weekStart string, weekEnd string, memberCount int, location *time.Location) (WeeklyArchive, bool, error) {
	if archive.WeekEnd < weekStart || archive.WeekStart > weekEnd {
		return archive, true, nil
	}
	exemptions := make(map[string]Exemption, len(archive.ExemptionsSnapshot))
	for _, exemption := range archive.ExemptionsSnapshot {
		exemptions[exemption.Date+"\x00"+exemption.MemberID] = exemption
	}
	remainingDays := make([]DailyResult, 0, len(archive.DailySnapshot))
	for _, day := range archive.DailySnapshot {
		if day.Date >= weekStart && day.Date <= weekEnd {
			importArchivedDay(next, day, exemptions, archive.ArchivedAt)
			continue
		}
		remainingDays = append(remainingDays, day)
	}
	remainingExemptions := make([]Exemption, 0, len(archive.ExemptionsSnapshot))
	for _, exemption := range archive.ExemptionsSnapshot {
		if exemption.Date >= weekStart && exemption.Date <= weekEnd {
			continue
		}
		remainingExemptions = append(remainingExemptions, exemption)
	}
	archive.DailySnapshot = remainingDays
	archive.ExemptionsSnapshot = remainingExemptions
	if archive.WeekEnd >= weekStart {
		cutoverEnd, err := addDate(weekStart, -1, location)
		if err != nil {
			return WeeklyArchive{}, false, err
		}
		archive.WeekEnd = cutoverEnd
		archive.WeekCalendar = CutoverWeekCalendar
	}
	if len(remainingDays) == 0 {
		return WeeklyArchive{}, false, nil
	}
	archive, err := rebuildArchive(archive, memberCount, location)
	if err != nil {
		return WeeklyArchive{}, false, err
	}
	return archive, true, nil
}

func migrateActiveBoundary(next *ActiveWeek, active ActiveWeek, weekStart string, location *time.Location) (ActiveWeek, error) {
	remainderEnd, err := addDate(weekStart, -1, location)
	if err != nil {
		return ActiveWeek{}, err
	}
	if remainderEnd > active.WeekEnd {
		remainderEnd = active.WeekEnd
	}
	remainder := ActiveWeek{
		WeekStart:         active.WeekStart,
		WeekEnd:           remainderEnd,
		WeekCalendar:      inferWeekCalendar(active.WeekStart, remainderEnd),
		RewardRuleVersion: active.RewardRuleVersion,
		Settings:          cloneSettings(active.Settings),
		Checkins:          make(map[string]map[string]Checkin),
		Exemptions:        make(map[string]map[string]Exemption),
	}
	for date, members := range active.Checkins {
		target := remainder.Checkins
		if date >= next.WeekStart && date <= next.WeekEnd {
			target = next.Checkins
		}
		copyCheckins(target, date, members)
	}
	for date, members := range active.Exemptions {
		target := remainder.Exemptions
		if date >= next.WeekStart && date <= next.WeekEnd {
			target = next.Exemptions
		}
		copyExemptions(target, date, members)
	}
	return remainder, nil
}

func (service *Service) archiveWeek(active ActiveWeek, memberCount int, location *time.Location) (WeeklyArchive, error) {
	view, err := CalculateWeek(active, memberCount, location)
	if err != nil {
		return WeeklyArchive{}, err
	}
	return WeeklyArchive{
		WeekStart:          view.WeekStart,
		WeekEnd:            view.WeekEnd,
		WeekCalendar:       active.WeekCalendar,
		RewardRuleVersion:  active.RewardRuleVersion,
		ArchivedAt:         service.now().UTC(),
		SettingsSnapshot:   view.Settings,
		DailySnapshot:      view.Days,
		Summary:            view.Summary,
		ExemptionsSnapshot: flattenExemptions(active.Exemptions),
	}, nil
}

func rebuildArchive(archive WeeklyArchive, memberCount int, location *time.Location) (WeeklyArchive, error) {
	active := ActiveWeek{
		WeekStart:         archive.WeekStart,
		WeekEnd:           archive.WeekEnd,
		WeekCalendar:      archive.WeekCalendar,
		RewardRuleVersion: archive.RewardRuleVersion,
		Settings:          cloneSettings(archive.SettingsSnapshot),
		Checkins:          make(map[string]map[string]Checkin),
		Exemptions:        make(map[string]map[string]Exemption),
	}
	exemptions := make(map[string]Exemption, len(archive.ExemptionsSnapshot))
	for _, exemption := range archive.ExemptionsSnapshot {
		exemptions[exemption.Date+"\x00"+exemption.MemberID] = exemption
	}
	for _, day := range archive.DailySnapshot {
		importArchivedDay(&active, day, exemptions, archive.ArchivedAt)
	}
	view, err := CalculateWeek(active, memberCount, location)
	if err != nil {
		return WeeklyArchive{}, err
	}
	archive.DailySnapshot = view.Days
	archive.Summary = view.Summary
	archive.ExemptionsSnapshot = flattenExemptions(active.Exemptions)
	return archive, nil
}

func importArchivedDay(active *ActiveWeek, day DailyResult, exemptions map[string]Exemption, fallback time.Time) {
	for memberID, result := range day.Members {
		if result.Exempt {
			if active.Exemptions[day.Date] == nil {
				active.Exemptions[day.Date] = make(map[string]Exemption)
			}
			exemption, exists := exemptions[day.Date+"\x00"+memberID]
			if !exists {
				exemption = Exemption{Date: day.Date, MemberID: memberID, ApprovedAt: fallback}
			}
			active.Exemptions[day.Date][memberID] = exemption
			continue
		}
		if active.Checkins[day.Date] == nil {
			active.Checkins[day.Date] = make(map[string]Checkin)
		}
		source := result.Source
		if source == "" {
			source = "calendar_migration"
		}
		active.Checkins[day.Date][memberID] = Checkin{Time: result.Time, Source: source, UpdatedAt: fallback}
	}
}

func copyCheckins(target map[string]map[string]Checkin, date string, source map[string]Checkin) {
	if target[date] == nil {
		target[date] = make(map[string]Checkin)
	}
	for memberID, checkin := range source {
		target[date][memberID] = checkin
	}
}

func copyExemptions(target map[string]map[string]Exemption, date string, source map[string]Exemption) {
	if target[date] == nil {
		target[date] = make(map[string]Exemption)
	}
	for memberID, exemption := range source {
		target[date][memberID] = exemption
	}
}

func addDate(date string, offset int, location *time.Location) (string, error) {
	parsed, err := time.ParseInLocation(time.DateOnly, date, location)
	if err != nil {
		return "", fmt.Errorf("%w: invalid date", ErrInvalidInput)
	}
	return parsed.AddDate(0, 0, offset).Format(time.DateOnly), nil
}
