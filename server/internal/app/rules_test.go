package app

import (
	"testing"
	"time"
)

func TestScoreForWeekdayAndWeekend(t *testing.T) {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	settings := DefaultSettings()

	weekdayScore, weekdayFine, err := ScoreFor("2026-08-24", "22:30", settings, location)
	if err != nil {
		t.Fatal(err)
	}
	if weekdayScore != 3 || weekdayFine != 0 {
		t.Fatalf("weekday result = (%d, %d), want (3, 0)", weekdayScore, weekdayFine)
	}

	weekendScore, weekendFine, err := ScoreFor("2026-08-28", "22:30", settings, location)
	if err != nil {
		t.Fatal(err)
	}
	if weekendScore != 5 || weekendFine != 0 {
		t.Fatalf("weekend result = (%d, %d), want (5, 0)", weekendScore, weekendFine)
	}
}

func TestSettingsAllowNegativeScoreAndFine(t *testing.T) {
	settings := DefaultSettings()
	settings.WeekdayTier[0].Score = -6
	settings.WeekdayTier[0].Fine = -20
	err := ValidateSettings(settings)
	if err != nil {
		t.Fatal(err)
	}

	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	score, fine, err := ScoreFor("2026-08-24", "22:20", settings, location)
	if err != nil {
		t.Fatal(err)
	}
	if score != -6 || fine != -20 {
		t.Fatalf("result = (%d, %d), want (-6, -20)", score, fine)
	}
}

func TestNightDateUsesCutoff(t *testing.T) {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 25, 1, 10, 0, 0, location)
	got := NightDate(now, DefaultSettings())
	if got != "2026-08-24" {
		t.Fatalf("night date = %s, want 2026-08-24", got)
	}
}

func TestWeekRangeStartsOnMonday(t *testing.T) {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	start, end, err := WeekRange("2026-08-30", location)
	if err != nil {
		t.Fatal(err)
	}
	if start != "2026-08-24" || end != "2026-08-30" {
		t.Fatalf("range = %s..%s, want 2026-08-24..2026-08-30", start, end)
	}
}

func TestExemptionCountsAsValidDayWithoutChangingAverage(t *testing.T) {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	active := ActiveWeek{
		WeekStart: "2026-08-24",
		WeekEnd:   "2026-08-30",
		Settings:  DefaultSettings(),
		Checkins: map[string]map[string]Checkin{
			"2026-08-24": {"member": {Time: "23:00", Source: "backfill"}},
		},
		Exemptions: map[string]map[string]Exemption{
			"2026-08-25": {"member": {Date: "2026-08-25", MemberID: "member"}},
		},
	}

	view, err := CalculateWeek(active, 1, location)
	if err != nil {
		t.Fatal(err)
	}
	summary := view.Summary.Members["member"]
	if summary.CheckinDays != 2 || view.Summary.TotalCheckins != 2 {
		t.Fatalf("valid days = %d/%d, want 2/2", summary.CheckinDays, view.Summary.TotalCheckins)
	}
	if summary.AverageSleepTime != "23:00" {
		t.Fatalf("average = %s, want 23:00", summary.AverageSleepTime)
	}
	result := view.Days[1].Members["member"]
	if !result.Exempt || result.Score != 0 || result.Fine != 0 || result.Time != "" {
		t.Fatalf("exemption result = %+v", result)
	}
}
