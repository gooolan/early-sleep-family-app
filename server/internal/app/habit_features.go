package app

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

var ErrExemptionLimit = errors.New("monthly exemption limit reached")
var ErrExemptDay = errors.New("exempt day cannot be changed")

const monthlyExemptionLimit = 2
const rewardReviewCycleDays = 30

func (service *Service) RequestExemption(ctx context.Context, token string, request ExemptionRequest) (FamilyView, error) {
	date := strings.TrimSpace(request.Date)
	_, err := time.Parse(time.DateOnly, date)
	if err != nil {
		return FamilyView{}, fmt.Errorf("%w: invalid exemption date", ErrInvalidInput)
	}

	family, member, err := service.authenticate(ctx, token)
	if err != nil {
		return FamilyView{}, err
	}
	changeID, err := randomID("exc_", 7)
	if err != nil {
		return FamilyView{}, err
	}

	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		err := service.ensureActiveWeek(current, date)
		if err != nil {
			return err
		}
		if date < current.ActiveWeek.WeekStart || date > current.ActiveWeek.WeekEnd {
			return ErrArchivedWeek
		}
		if _, exists := current.ActiveWeek.Exemptions[date][member.ID]; exists {
			return nil
		}

		current.PendingExemptions = removePendingExemption(current.PendingExemptions, member.ID, date)
		if countMonthlyExemptions(*current, member.ID, date[:7], true) >= monthlyExemptionLimit {
			return ErrExemptionLimit
		}
		if len(current.Members) < 2 {
			applyExemption(current, member.ID, date, service.now().UTC())
			return nil
		}
		current.PendingExemptions = append(current.PendingExemptions, ExemptionChange{
			ID:          changeID,
			WeekStart:   current.ActiveWeek.WeekStart,
			Date:        date,
			MemberID:    member.ID,
			RequestedBy: member.ID,
			CreatedAt:   service.now().UTC(),
		})
		return nil
	})
	if err != nil {
		return FamilyView{}, err
	}
	return service.buildFamilyView(family, member.ID)
}

func (service *Service) ReviewExemptionChange(ctx context.Context, token string, changeID string, approve bool) (FamilyView, error) {
	changeID = strings.TrimSpace(changeID)
	if changeID == "" {
		return FamilyView{}, fmt.Errorf("%w: change id is required", ErrInvalidInput)
	}
	family, member, err := service.authenticate(ctx, token)
	if err != nil {
		return FamilyView{}, err
	}

	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		index := -1
		var change ExemptionChange
		for candidateIndex, candidate := range current.PendingExemptions {
			if candidate.ID == changeID {
				index = candidateIndex
				change = candidate
				break
			}
		}
		if index < 0 {
			return ErrNotFound
		}
		if change.RequestedBy == member.ID {
			return ErrSelfApproval
		}
		if change.WeekStart != current.ActiveWeek.WeekStart {
			return ErrArchivedWeek
		}
		if approve {
			if countMonthlyExemptions(*current, change.MemberID, change.Date[:7], false) >= monthlyExemptionLimit {
				return ErrExemptionLimit
			}
			applyExemption(current, change.MemberID, change.Date, service.now().UTC())
		}
		current.PendingExemptions = append(current.PendingExemptions[:index], current.PendingExemptions[index+1:]...)
		if current.PendingExemptions == nil {
			current.PendingExemptions = make([]ExemptionChange, 0)
		}
		return nil
	})
	if err != nil {
		return FamilyView{}, err
	}
	return service.buildFamilyView(family, member.ID)
}

func (service *Service) CompleteRewardReview(ctx context.Context, token string) (FamilyView, error) {
	family, member, err := service.authenticate(ctx, token)
	if err != nil {
		return FamilyView{}, err
	}
	if member.Role != RoleOwner {
		return FamilyView{}, ErrUnauthorized
	}
	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		current.RewardReviewStartedAt = service.now().UTC()
		return nil
	})
	if err != nil {
		return FamilyView{}, err
	}
	return service.buildFamilyView(family, member.ID)
}

func applyExemption(family *Family, memberID string, date string, approvedAt time.Time) {
	if family.ActiveWeek.Exemptions == nil {
		family.ActiveWeek.Exemptions = make(map[string]map[string]Exemption)
	}
	if family.ActiveWeek.Exemptions[date] == nil {
		family.ActiveWeek.Exemptions[date] = make(map[string]Exemption)
	}
	family.ActiveWeek.Exemptions[date][memberID] = Exemption{Date: date, MemberID: memberID, ApprovedAt: approvedAt}
	delete(family.ActiveWeek.Checkins[date], memberID)
	if len(family.ActiveWeek.Checkins[date]) == 0 {
		delete(family.ActiveWeek.Checkins, date)
	}
	family.Pending = removePendingChange(family.Pending, memberID, date)
}

func removePendingExemption(changes []ExemptionChange, memberID string, date string) []ExemptionChange {
	result := make([]ExemptionChange, 0, len(changes))
	for _, change := range changes {
		if change.MemberID == memberID && change.Date == date {
			continue
		}
		result = append(result, change)
	}
	return result
}

func countMonthlyExemptions(family Family, memberID string, month string, includePending bool) int {
	count := 0
	for date, members := range family.ActiveWeek.Exemptions {
		if strings.HasPrefix(date, month) {
			if _, exists := members[memberID]; exists {
				count++
			}
		}
	}
	for _, archive := range family.Archives {
		for _, exemption := range archive.ExemptionsSnapshot {
			if exemption.MemberID == memberID && strings.HasPrefix(exemption.Date, month) {
				count++
			}
		}
	}
	if includePending {
		for _, change := range family.PendingExemptions {
			if change.MemberID == memberID && strings.HasPrefix(change.Date, month) {
				count++
			}
		}
	}
	return count
}

func flattenExemptions(exemptions map[string]map[string]Exemption) []Exemption {
	result := make([]Exemption, 0)
	for _, members := range exemptions {
		for _, exemption := range members {
			result = append(result, exemption)
		}
	}
	sort.Slice(result, func(left int, right int) bool {
		if result[left].Date == result[right].Date {
			return result[left].MemberID < result[right].MemberID
		}
		return result[left].Date < result[right].Date
	})
	return result
}

func buildRewardReviewStatus(family Family, now time.Time) RewardReviewStatus {
	startedAt := family.RewardReviewStartedAt
	if startedAt.IsZero() {
		startedAt = family.CreatedAt
	}
	nextReviewAt := startedAt.AddDate(0, 0, rewardReviewCycleDays)
	remaining := nextReviewAt.Sub(now).Hours() / 24
	daysRemaining := int(remaining)
	if remaining > float64(daysRemaining) {
		daysRemaining++
	}
	if daysRemaining < 0 {
		daysRemaining = 0
	}
	return RewardReviewStatus{
		CycleStartedAt: startedAt,
		NextReviewAt:   nextReviewAt,
		Due:            !now.Before(nextReviewAt),
		DaysRemaining:  daysRemaining,
	}
}
