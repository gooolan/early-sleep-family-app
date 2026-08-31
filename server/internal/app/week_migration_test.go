package app

import (
	"testing"
	"time"
)

func TestWeekMigrationMovesSundayFromLegacyActiveWeek(t *testing.T) {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 31, 1, 0, 0, 0, location)
	service := &Service{now: func() time.Time { return now }}
	settings := DefaultSettings()
	family := Family{
		Version:  6,
		Timezone: "Asia/Shanghai",
		Members:  map[string]Member{"member": {ID: "member", Name: "甲"}},
		ActiveWeek: ActiveWeek{
			WeekStart:         "2026-08-24",
			WeekEnd:           "2026-08-30",
			WeekCalendar:      LegacyWeekCalendar,
			RewardRuleVersion: CurrentRewardRuleVersion,
			Settings:          settings,
			Checkins: map[string]map[string]Checkin{
				"2026-08-24": {"member": {Time: "23:00", Source: "now", UpdatedAt: now.UTC()}},
				"2026-08-30": {"member": {Time: "23:10", Source: "now", UpdatedAt: now.UTC()}},
			},
			Exemptions: make(map[string]map[string]Exemption),
		},
		Archives:          make([]WeeklyArchive, 0),
		Pending:           make([]CheckinChange, 0),
		PendingExemptions: make([]ExemptionChange, 0),
	}

	err = service.migrateWeekCalendar(&family, "2026-08-30", location)
	if err != nil {
		t.Fatal(err)
	}
	if family.ActiveWeek.WeekStart != "2026-08-30" || family.ActiveWeek.WeekEnd != "2026-09-05" {
		t.Fatalf("active week = %s..%s", family.ActiveWeek.WeekStart, family.ActiveWeek.WeekEnd)
	}
	if family.ActiveWeek.Checkins["2026-08-30"]["member"].Time != "23:10" {
		t.Fatalf("active checkins = %+v", family.ActiveWeek.Checkins)
	}
	if len(family.Archives) != 1 || family.Archives[0].WeekStart != "2026-08-24" || family.Archives[0].WeekEnd != "2026-08-29" {
		t.Fatalf("archives = %+v", family.Archives)
	}
	if family.Archives[0].Summary.ExpectedCheckin != 6 || family.Archives[0].DailySnapshot[0].Date != "2026-08-24" {
		t.Fatalf("cutover archive = %+v", family.Archives[0])
	}
}
