package app

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	ErrInvalidInput = errors.New("invalid input")
	ErrArchivedWeek = errors.New("week is archived")
)

const DefaultRewardNote = "旧版兼容字段。新版 App 按内置规则显示奖励参考金额，实际转账由双方手工完成。"

func DefaultSettings() Settings {
	return Settings{
		IdealTime:  "23:00",
		CutoffHour: 6,
		RewardNote: DefaultRewardNote,
		WeekdayTier: []RuleTier{
			{End: "22:30", Score: 3, Fine: 0},
			{End: "23:00", Score: 2, Fine: 0},
			{End: "23:30", Score: 1, Fine: 0},
			{End: "00:00", Score: 0, Fine: 0},
			{End: "00:30", Score: -1, Fine: 20},
			{End: "01:00", Score: -2, Fine: 50},
			{End: "01:30", Score: -3, Fine: 100},
			{End: "", Score: -3, Fine: 100},
		},
		WeekendTier: []RuleTier{
			{End: "22:30", Score: 5, Fine: 0},
			{End: "23:00", Score: 4, Fine: 0},
			{End: "23:30", Score: 3, Fine: 0},
			{End: "00:00", Score: 2, Fine: 0},
			{End: "00:30", Score: 1, Fine: 0},
			{End: "01:00", Score: 0, Fine: 0},
			{End: "01:30", Score: -1, Fine: 20},
			{End: "", Score: -2, Fine: 50},
		},
	}
}

func ValidateSettings(settings Settings) error {
	if settings.CutoffHour < 0 || settings.CutoffHour > 11 {
		return fmt.Errorf("%w: cutoffHour must be between 0 and 11", ErrInvalidInput)
	}

	err := validateTime(settings.IdealTime)
	if err != nil {
		return fmt.Errorf("%w: idealTime: %v", ErrInvalidInput, err)
	}

	err = validateTiers(settings.WeekdayTier)
	if err != nil {
		return fmt.Errorf("%w: weekdayTiers: %v", ErrInvalidInput, err)
	}

	err = validateTiers(settings.WeekendTier)
	if err != nil {
		return fmt.Errorf("%w: weekendTiers: %v", ErrInvalidInput, err)
	}
	if len(settings.RewardNote) > 2000 {
		return fmt.Errorf("%w: rewardNote is too long", ErrInvalidInput)
	}

	return nil
}

func NormalizeSettings(settings Settings) Settings {
	if settings.RewardNote == "" {
		settings.RewardNote = DefaultRewardNote
	}
	return settings
}

func validateTiers(tiers []RuleTier) error {
	if len(tiers) < 2 {
		return errors.New("at least two tiers are required")
	}

	previous := -1
	for index, tier := range tiers {
		last := index == len(tiers)-1
		if last {
			if tier.End != "" {
				return errors.New("the last tier end must be empty")
			}
			continue
		}

		if tier.End == "" {
			return errors.New("only the last tier may have an empty end")
		}

		minutes, err := timeToNightMinutes(tier.End)
		if err != nil {
			return err
		}
		if minutes <= previous {
			return errors.New("tier ends must be strictly increasing")
		}
		previous = minutes
	}

	return nil
}

func validateTime(value string) error {
	parts := strings.Split(value, ":")
	if len(parts) != 2 {
		return errors.New("time must use HH:mm")
	}

	hour, err := strconv.Atoi(parts[0])
	if err != nil {
		return errors.New("invalid hour")
	}
	minute, err := strconv.Atoi(parts[1])
	if err != nil {
		return errors.New("invalid minute")
	}
	if hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return errors.New("time is out of range")
	}
	return nil
}

func timeToNightMinutes(value string) (int, error) {
	err := validateTime(value)
	if err != nil {
		return 0, err
	}

	parts := strings.Split(value, ":")
	hour, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, err
	}
	minute, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, err
	}
	if hour < 12 {
		hour += 24
	}
	return hour*60 + minute, nil
}

func ScoreFor(date string, sleepTime string, settings Settings, location *time.Location) (float64, int, error) {
	parsedDate, err := time.ParseInLocation(time.DateOnly, date, location)
	if err != nil {
		return 0, 0, fmt.Errorf("%w: invalid date", ErrInvalidInput)
	}

	minutes, err := timeToNightMinutes(sleepTime)
	if err != nil {
		return 0, 0, fmt.Errorf("%w: invalid sleep time", ErrInvalidInput)
	}

	tiers := settings.WeekdayTier
	if parsedDate.Weekday() == time.Friday || parsedDate.Weekday() == time.Saturday {
		tiers = settings.WeekendTier
	}

	previousEnd := 0
	previousScore := float64(0)
	for index, tier := range tiers {
		if tier.End == "" {
			return tier.Score, tier.Fine, nil
		}

		end, err := timeToNightMinutes(tier.End)
		if err != nil {
			return 0, 0, err
		}
		if minutes <= end {
			if index == 0 {
				return tier.Score, tier.Fine, nil
			}
			progress := float64(minutes-previousEnd) / float64(end-previousEnd)
			score := previousScore + (tier.Score-previousScore)*progress
			return roundScore(score), tier.Fine, nil
		}
		previousEnd = end
		previousScore = tier.Score
	}

	return 0, 0, errors.New("no matching rule tier")
}

func roundScore(score float64) float64 {
	return math.Round(score*10) / 10
}

func NightDate(now time.Time, settings Settings) string {
	local := now
	if now.Hour() < settings.CutoffHour {
		local = now.AddDate(0, 0, -1)
	}
	return local.Format(time.DateOnly)
}

func WeekRange(date string, location *time.Location) (string, string, error) {
	parsed, err := time.ParseInLocation(time.DateOnly, date, location)
	if err != nil {
		return "", "", fmt.Errorf("%w: invalid date", ErrInvalidInput)
	}

	weekday := int(parsed.Weekday())
	start := parsed.AddDate(0, 0, -weekday)
	end := start.AddDate(0, 0, 6)
	return start.Format(time.DateOnly), end.Format(time.DateOnly), nil
}

func legacyWeekRange(date string, location *time.Location) (string, string, error) {
	parsed, err := time.ParseInLocation(time.DateOnly, date, location)
	if err != nil {
		return "", "", fmt.Errorf("%w: invalid date", ErrInvalidInput)
	}

	weekday := int(parsed.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	start := parsed.AddDate(0, 0, 1-weekday)
	end := start.AddDate(0, 0, 6)
	return start.Format(time.DateOnly), end.Format(time.DateOnly), nil
}

func CalculateWeek(active ActiveWeek, memberCount int, location *time.Location) (ActiveWeekView, error) {
	weekDays, err := daysBetween(active.WeekStart, active.WeekEnd, location)
	if err != nil {
		return ActiveWeekView{}, err
	}
	dateSet := make(map[string]struct{}, len(active.Checkins)+len(active.Exemptions))
	for date := range active.Checkins {
		dateSet[date] = struct{}{}
	}
	for date := range active.Exemptions {
		dateSet[date] = struct{}{}
	}
	dates := make([]string, 0, len(dateSet))
	for date := range dateSet {
		dates = append(dates, date)
	}
	sort.Strings(dates)

	days := make([]DailyResult, 0, len(dates))
	summary := WeekSummary{
		Members:         make(map[string]MemberSummary),
		ExpectedCheckin: memberCount * weekDays,
	}
	timeTotals := make(map[string]int)
	timeCounts := make(map[string]int)

	for _, date := range dates {
		memberResults := make(map[string]DailyMemberResult)
		memberSet := make(map[string]struct{})
		for memberID := range active.Checkins[date] {
			memberSet[memberID] = struct{}{}
		}
		for memberID := range active.Exemptions[date] {
			memberSet[memberID] = struct{}{}
		}
		for memberID := range memberSet {
			_, exempt := active.Exemptions[date][memberID]
			if exempt {
				memberResults[memberID] = DailyMemberResult{Score: 0, Fine: 0, Source: "exemption", Exempt: true}
				memberSummary := summary.Members[memberID]
				memberSummary.CheckinDays++
				summary.Members[memberID] = memberSummary
				summary.TotalCheckins++
				continue
			}

			checkin := active.Checkins[date][memberID]
			score, fine, err := ScoreFor(date, checkin.Time, active.Settings, location)
			if err != nil {
				return ActiveWeekView{}, err
			}

			memberResults[memberID] = DailyMemberResult{
				Time:   checkin.Time,
				Score:  score,
				Fine:   fine,
				Source: checkin.Source,
			}

			memberSummary := summary.Members[memberID]
			memberSummary.TotalScore = roundScore(memberSummary.TotalScore + score)
			memberSummary.TotalFine += fine
			memberSummary.CheckinDays++
			summary.Members[memberID] = memberSummary

			minutes, err := timeToNightMinutes(checkin.Time)
			if err != nil {
				return ActiveWeekView{}, err
			}
			timeTotals[memberID] += minutes
			timeCounts[memberID]++
			summary.TotalCheckins++
		}
		days = append(days, DailyResult{Date: date, Members: memberResults})
	}

	for memberID, memberSummary := range summary.Members {
		if timeCounts[memberID] > 0 {
			average := timeTotals[memberID] / timeCounts[memberID]
			average %= 24 * 60
			memberSummary.AverageSleepTime = fmt.Sprintf("%02d:%02d", average/60, average%60)
			summary.Members[memberID] = memberSummary
		}
	}

	if summary.ExpectedCheckin > 0 {
		summary.CompletionRate = summary.TotalCheckins * 100 / summary.ExpectedCheckin
	}

	return ActiveWeekView{
		WeekStart:         active.WeekStart,
		WeekEnd:           active.WeekEnd,
		WeekCalendar:      active.WeekCalendar,
		RewardRuleVersion: active.RewardRuleVersion,
		Settings:          active.Settings,
		Days:              days,
		Summary:           summary,
	}, nil
}
