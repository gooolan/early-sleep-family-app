package app

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

var ErrSelfApproval = errors.New("a member cannot review their own checkin change")
var ErrNotRequester = errors.New("only the requester can cancel a change")
var ErrFutureDate = errors.New("future sleep date cannot be changed")

type Service struct {
	store *Store
	now   func() time.Time
}

func NewService(store *Store) *Service {
	return &Service{store: store, now: time.Now}
}

func (service *Service) Identify(ctx context.Context, request IdentityRequest) (IdentityStatus, error) {
	phone, err := NormalizePhone(request.Phone)
	if err != nil {
		return IdentityStatus{}, err
	}
	_, _, err = service.store.FindMemberByPhone(ctx, phone)
	if errors.Is(err, ErrNotFound) {
		return IdentityStatus{Exists: false, Phone: phone, VerificationRequired: false}, nil
	}
	if err != nil {
		return IdentityStatus{}, err
	}
	return IdentityStatus{Exists: true, Phone: phone, VerificationRequired: false}, nil
}

func (service *Service) Login(ctx context.Context, request SessionRequest) (FamilySession, error) {
	phone, err := NormalizePhone(request.Phone)
	if err != nil {
		return FamilySession{}, err
	}
	family, member, err := service.store.FindMemberByPhone(ctx, phone)
	if err != nil {
		return FamilySession{}, err
	}
	memberSecret, err := randomSecret(24)
	if err != nil {
		return FamilySession{}, err
	}
	fallbackJoinCode, err := randomID("", 8)
	if err != nil {
		return FamilySession{}, err
	}

	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		currentMember, exists := current.Members[member.ID]
		if !exists || currentMember.Phone != phone {
			return ErrNotFound
		}
		currentMember.TokenHash = hashValue(memberSecret)
		current.Members[member.ID] = currentMember
		if current.JoinCode == "" {
			current.JoinCode = strings.ToUpper(fallbackJoinCode)
			current.JoinCodeHash = hashValue(strings.ToLower(fallbackJoinCode))
		}
		return nil
	})
	if err != nil {
		return FamilySession{}, err
	}
	view, err := service.buildFamilyView(family, member.ID)
	if err != nil {
		return FamilySession{}, err
	}
	joinCode := ""
	if member.Role == RoleOwner {
		joinCode = family.JoinCode
	}
	return FamilySession{
		Token:    buildMemberToken(family.ID, member.ID, memberSecret),
		JoinCode: joinCode,
		Family:   view,
	}, nil
}

func (service *Service) CreateFamily(ctx context.Context, request CreateFamilyRequest) (FamilySession, error) {
	request.FamilyName = strings.TrimSpace(request.FamilyName)
	request.Nickname = strings.TrimSpace(request.Nickname)
	if request.FamilyName == "" || request.Nickname == "" {
		return FamilySession{}, fmt.Errorf("%w: familyName and nickname are required", ErrInvalidInput)
	}
	phone, err := NormalizePhone(request.Phone)
	if err != nil {
		return FamilySession{}, err
	}

	timezone := strings.TrimSpace(request.Timezone)
	if timezone == "" {
		timezone = "Asia/Shanghai"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return FamilySession{}, fmt.Errorf("%w: invalid timezone", ErrInvalidInput)
	}

	settings := DefaultSettings()
	if request.Settings != nil {
		settings = NormalizeSettings(*request.Settings)
	}
	err = ValidateSettings(settings)
	if err != nil {
		return FamilySession{}, err
	}

	familyID, err := randomID("fam_", 7)
	if err != nil {
		return FamilySession{}, err
	}
	memberID, err := randomID("mem_", 7)
	if err != nil {
		return FamilySession{}, err
	}
	memberSecret, err := randomSecret(24)
	if err != nil {
		return FamilySession{}, err
	}
	joinCode, err := randomID("", 8)
	if err != nil {
		return FamilySession{}, err
	}

	now := service.now().In(location)
	nightDate := NightDate(now, settings)
	weekStart, weekEnd, err := WeekRange(nightDate, location)
	if err != nil {
		return FamilySession{}, err
	}

	family := Family{
		Version:      6,
		Revision:     1,
		ID:           familyID,
		Name:         request.FamilyName,
		Timezone:     timezone,
		JoinCode:     strings.ToUpper(joinCode),
		JoinCodeHash: hashValue(strings.ToLower(joinCode)),
		CreatedAt:    now.UTC(),
		Members: map[string]Member{
			memberID: {
				ID:        memberID,
				Name:      request.Nickname,
				Role:      RoleOwner,
				Phone:     phone,
				TokenHash: hashValue(memberSecret),
				JoinedAt:  now.UTC(),
			},
		},
		ActiveWeek: ActiveWeek{
			WeekStart:         weekStart,
			WeekEnd:           weekEnd,
			RewardRuleVersion: CurrentRewardRuleVersion,
			Settings:          settings,
			Checkins:          make(map[string]map[string]Checkin),
			Exemptions:        make(map[string]map[string]Exemption),
		},
		Archives:              make([]WeeklyArchive, 0),
		Pending:               make([]CheckinChange, 0),
		PendingExemptions:     make([]ExemptionChange, 0),
		RewardReviewStartedAt: now.UTC(),
	}

	err = service.store.Create(ctx, family)
	if err != nil {
		return FamilySession{}, err
	}

	view, err := service.buildFamilyView(family, memberID)
	if err != nil {
		return FamilySession{}, err
	}
	return FamilySession{
		Token:    buildMemberToken(familyID, memberID, memberSecret),
		JoinCode: strings.ToUpper(joinCode),
		Family:   view,
	}, nil
}

func (service *Service) JoinFamily(ctx context.Context, request JoinFamilyRequest) (FamilySession, error) {
	request.JoinCode = strings.ToLower(strings.TrimSpace(request.JoinCode))
	request.Nickname = strings.TrimSpace(request.Nickname)
	if request.JoinCode == "" || request.Nickname == "" {
		return FamilySession{}, fmt.Errorf("%w: joinCode and nickname are required", ErrInvalidInput)
	}
	phone, err := NormalizePhone(request.Phone)
	if err != nil {
		return FamilySession{}, err
	}

	family, err := service.store.FindByJoinCode(ctx, hashValue(request.JoinCode))
	if err != nil {
		return FamilySession{}, err
	}
	if len(family.Members) >= 2 {
		return FamilySession{}, ErrFamilyFull
	}

	memberID, err := randomID("mem_", 7)
	if err != nil {
		return FamilySession{}, err
	}
	memberSecret, err := randomSecret(24)
	if err != nil {
		return FamilySession{}, err
	}

	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		if len(current.Members) >= 2 {
			return ErrFamilyFull
		}
		current.Members[memberID] = Member{
			ID:        memberID,
			Name:      request.Nickname,
			Role:      RoleMember,
			Phone:     phone,
			TokenHash: hashValue(memberSecret),
			JoinedAt:  service.now().UTC(),
		}
		return nil
	})
	if err != nil {
		return FamilySession{}, err
	}

	view, err := service.buildFamilyView(family, memberID)
	if err != nil {
		return FamilySession{}, err
	}
	return FamilySession{
		Token:  buildMemberToken(family.ID, memberID, memberSecret),
		Family: view,
	}, nil
}

func (service *Service) GetFamily(ctx context.Context, token string) (FamilyView, error) {
	family, member, err := service.authenticate(ctx, token)
	if err != nil {
		return FamilyView{}, err
	}
	location, err := time.LoadLocation(family.Timezone)
	if err != nil {
		return FamilyView{}, err
	}
	nightDate := NightDate(service.now().In(location), family.ActiveWeek.Settings)
	targetStart, _, err := WeekRange(nightDate, location)
	if err != nil {
		return FamilyView{}, err
	}
	if targetStart > family.ActiveWeek.WeekStart {
		family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
			err := service.ensureActiveWeek(current, nightDate)
			if err != nil {
				return err
			}
			return nil
		})
		if err != nil {
			return FamilyView{}, err
		}
	}
	return service.buildFamilyView(family, member.ID)
}

func (service *Service) UpdateSettings(ctx context.Context, token string, settings Settings) (FamilyView, error) {
	settings = NormalizeSettings(settings)
	err := ValidateSettings(settings)
	if err != nil {
		return FamilyView{}, err
	}

	family, member, err := service.authenticate(ctx, token)
	if err != nil {
		return FamilyView{}, err
	}
	if member.Role != RoleOwner {
		return FamilyView{}, ErrUnauthorized
	}

	location, err := time.LoadLocation(family.Timezone)
	if err != nil {
		return FamilyView{}, err
	}
	nightDate := NightDate(service.now().In(location), family.ActiveWeek.Settings)
	family, err = service.store.Update(ctx, family.ID, func(current *Family) error {
		err := service.ensureActiveWeek(current, nightDate)
		if err != nil {
			return err
		}
		current.ActiveWeek.Settings = settings
		return nil
	})
	if err != nil {
		return FamilyView{}, err
	}
	return service.buildFamilyView(family, member.ID)
}

func (service *Service) CheckInNow(ctx context.Context, token string) (FamilyView, error) {
	family, member, err := service.authenticate(ctx, token)
	if err != nil {
		return FamilyView{}, err
	}
	location, err := time.LoadLocation(family.Timezone)
	if err != nil {
		return FamilyView{}, err
	}
	now := service.now().In(location)
	nightDate := NightDate(now, family.ActiveWeek.Settings)
	sleepTime := now.Format("15:04")
	return service.upsertCheckin(ctx, family, member, nightDate, CheckinRequest{Time: sleepTime, Source: "now"})
}

func (service *Service) UpsertCheckin(ctx context.Context, token string, date string, request CheckinRequest) (FamilyView, error) {
	family, member, err := service.authenticate(ctx, token)
	if err != nil {
		return FamilyView{}, err
	}
	err = service.validateReachedDate(family, date)
	if err != nil {
		return FamilyView{}, err
	}
	return service.upsertCheckin(ctx, family, member, date, request)
}

func (service *Service) upsertCheckin(ctx context.Context, family Family, member Member, date string, request CheckinRequest) (FamilyView, error) {
	err := validateTime(request.Time)
	if err != nil {
		return FamilyView{}, fmt.Errorf("%w: invalid time", ErrInvalidInput)
	}
	if request.Source != "now" && request.Source != "backfill" {
		request.Source = "backfill"
	}

	changeID, err := randomID("chg_", 7)
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
			return ErrExemptDay
		}
		if request.Source == "now" || len(current.Members) < 2 {
			if current.ActiveWeek.Checkins[date] == nil {
				current.ActiveWeek.Checkins[date] = make(map[string]Checkin)
			}
			current.ActiveWeek.Checkins[date][member.ID] = Checkin{
				Time:      request.Time,
				Source:    request.Source,
				UpdatedAt: service.now().UTC(),
			}
			current.Pending = removePendingChange(current.Pending, member.ID, date)
			return nil
		}

		originalTime := ""
		if checkins := current.ActiveWeek.Checkins[date]; checkins != nil {
			originalTime = checkins[member.ID].Time
		}
		if originalTime == request.Time {
			current.Pending = removePendingChange(current.Pending, member.ID, date)
			return nil
		}
		current.Pending = removePendingChange(current.Pending, member.ID, date)
		current.Pending = append(current.Pending, CheckinChange{
			ID:           changeID,
			WeekStart:    current.ActiveWeek.WeekStart,
			Date:         date,
			MemberID:     member.ID,
			RequestedBy:  member.ID,
			Kind:         CheckinChangeUpsert,
			OriginalTime: originalTime,
			ProposedTime: request.Time,
			CreatedAt:    service.now().UTC(),
		})
		return nil
	})
	if err != nil {
		return FamilyView{}, err
	}
	return service.buildFamilyView(family, member.ID)
}

func (service *Service) ReviewCheckinChange(ctx context.Context, token string, changeID string, approve bool) (FamilyView, error) {
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
		var change CheckinChange
		for candidateIndex, candidate := range current.Pending {
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
		if change.WeekStart != current.ActiveWeek.WeekStart || change.Date < current.ActiveWeek.WeekStart || change.Date > current.ActiveWeek.WeekEnd {
			return ErrArchivedWeek
		}

		if change.Kind != CheckinChangeUpsert {
			return fmt.Errorf("%w: unsupported checkin change", ErrInvalidInput)
		}
		if approve {
			if current.ActiveWeek.Checkins[change.Date] == nil {
				current.ActiveWeek.Checkins[change.Date] = make(map[string]Checkin)
			}
			current.ActiveWeek.Checkins[change.Date][change.MemberID] = Checkin{
				Time:      change.ProposedTime,
				Source:    "approved_edit",
				UpdatedAt: service.now().UTC(),
			}
		}

		current.Pending = append(current.Pending[:index], current.Pending[index+1:]...)
		if current.Pending == nil {
			current.Pending = make([]CheckinChange, 0)
		}
		return nil
	})
	if err != nil {
		return FamilyView{}, err
	}
	return service.buildFamilyView(family, member.ID)
}

func (service *Service) CancelCheckinChange(ctx context.Context, token string, changeID string) (FamilyView, error) {
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
		for candidateIndex, candidate := range current.Pending {
			if candidate.ID == changeID {
				index = candidateIndex
				if candidate.RequestedBy != member.ID {
					return ErrNotRequester
				}
				break
			}
		}
		if index < 0 {
			return ErrNotFound
		}
		current.Pending = append(current.Pending[:index], current.Pending[index+1:]...)
		if current.Pending == nil {
			current.Pending = make([]CheckinChange, 0)
		}
		return nil
	})
	if err != nil {
		return FamilyView{}, err
	}
	return service.buildFamilyView(family, member.ID)
}

func (service *Service) validateReachedDate(family Family, date string) error {
	_, err := time.Parse(time.DateOnly, date)
	if err != nil {
		return fmt.Errorf("%w: invalid date", ErrInvalidInput)
	}
	location, err := time.LoadLocation(family.Timezone)
	if err != nil {
		return err
	}
	reachedDate := NightDate(service.now().In(location), family.ActiveWeek.Settings)
	if date > reachedDate {
		return ErrFutureDate
	}
	return nil
}

func removePendingChange(changes []CheckinChange, memberID string, date string) []CheckinChange {
	result := make([]CheckinChange, 0, len(changes))
	for _, change := range changes {
		if change.MemberID == memberID && change.Date == date {
			continue
		}
		result = append(result, change)
	}
	return result
}

func (service *Service) authenticate(ctx context.Context, token string) (Family, Member, error) {
	familyID, memberID, secret, err := parseMemberToken(token)
	if err != nil {
		return Family{}, Member{}, ErrUnauthorized
	}
	family, err := service.store.Get(ctx, familyID)
	if err != nil {
		return Family{}, Member{}, ErrUnauthorized
	}
	member, exists := family.Members[memberID]
	if !exists || !constantEqual(member.TokenHash, hashValue(secret)) {
		return Family{}, Member{}, ErrUnauthorized
	}
	return family, member, nil
}

func (service *Service) ensureActiveWeek(family *Family, targetDate string) error {
	location, err := time.LoadLocation(family.Timezone)
	if err != nil {
		return err
	}
	targetStart, targetEnd, err := WeekRange(targetDate, location)
	if err != nil {
		return err
	}
	if targetStart == family.ActiveWeek.WeekStart {
		return nil
	}
	if targetStart < family.ActiveWeek.WeekStart {
		return ErrArchivedWeek
	}

	if hasCheckins(family.ActiveWeek) {
		view, err := CalculateWeek(family.ActiveWeek, len(family.Members), location)
		if err != nil {
			return err
		}
		family.Archives = append(family.Archives, WeeklyArchive{
			WeekStart:          view.WeekStart,
			WeekEnd:            view.WeekEnd,
			RewardRuleVersion:  family.ActiveWeek.RewardRuleVersion,
			ArchivedAt:         service.now().UTC(),
			SettingsSnapshot:   view.Settings,
			DailySnapshot:      view.Days,
			Summary:            view.Summary,
			ExemptionsSnapshot: flattenExemptions(family.ActiveWeek.Exemptions),
		})
	}

	family.ActiveWeek = ActiveWeek{
		WeekStart:         targetStart,
		WeekEnd:           targetEnd,
		RewardRuleVersion: CurrentRewardRuleVersion,
		Settings:          cloneSettings(family.ActiveWeek.Settings),
		Checkins:          make(map[string]map[string]Checkin),
		Exemptions:        make(map[string]map[string]Exemption),
	}
	family.Pending = make([]CheckinChange, 0)
	family.PendingExemptions = make([]ExemptionChange, 0)
	return nil
}

func (service *Service) buildFamilyView(family Family, currentMemberID string) (FamilyView, error) {
	location, err := time.LoadLocation(family.Timezone)
	if err != nil {
		return FamilyView{}, err
	}
	active, err := CalculateWeek(family.ActiveWeek, len(family.Members), location)
	if err != nil {
		return FamilyView{}, err
	}
	nightDate := NightDate(service.now().In(location), family.ActiveWeek.Settings)
	if nightDate >= family.ActiveWeek.WeekStart && nightDate <= family.ActiveWeek.WeekEnd {
		elapsedDays, err := daysBetween(family.ActiveWeek.WeekStart, nightDate, location)
		if err != nil {
			return FamilyView{}, err
		}
		active.Summary.ExpectedCheckin = len(family.Members) * elapsedDays
		if active.Summary.ExpectedCheckin > 0 {
			active.Summary.CompletionRate = active.Summary.TotalCheckins * 100 / active.Summary.ExpectedCheckin
		}
	}

	memberIDs := make([]string, 0, len(family.Members))
	for memberID := range family.Members {
		memberIDs = append(memberIDs, memberID)
	}
	sort.Strings(memberIDs)
	members := make([]MemberView, 0, len(memberIDs))
	for _, memberID := range memberIDs {
		member := family.Members[memberID]
		members = append(members, MemberView{ID: member.ID, Name: member.Name, Role: member.Role})
	}

	current, exists := family.Members[currentMemberID]
	if !exists {
		return FamilyView{}, ErrUnauthorized
	}
	archives := make([]WeeklyArchive, len(family.Archives))
	copy(archives, family.Archives)
	sort.Slice(archives, func(left int, right int) bool {
		return archives[left].WeekStart > archives[right].WeekStart
	})
	pending := make([]CheckinChange, len(family.Pending))
	copy(pending, family.Pending)
	sort.Slice(pending, func(left int, right int) bool {
		return pending[left].CreatedAt.After(pending[right].CreatedAt)
	})
	pendingExemptions := make([]ExemptionChange, len(family.PendingExemptions))
	copy(pendingExemptions, family.PendingExemptions)
	sort.Slice(pendingExemptions, func(left int, right int) bool {
		return pendingExemptions[left].CreatedAt.After(pendingExemptions[right].CreatedAt)
	})
	review := buildRewardReviewStatus(family, service.now())
	return FamilyView{
		ID:                family.ID,
		Name:              family.Name,
		Timezone:          family.Timezone,
		CurrentMember:     MemberView{ID: current.ID, Name: current.Name, Role: current.Role, Phone: current.Phone},
		Members:           members,
		ActiveWeek:        active,
		Archives:          archives,
		Pending:           pending,
		PendingExemptions: pendingExemptions,
		RewardReview:      review,
	}, nil
}

func hasCheckins(active ActiveWeek) bool {
	for _, members := range active.Checkins {
		if len(members) > 0 {
			return true
		}
	}
	for _, members := range active.Exemptions {
		if len(members) > 0 {
			return true
		}
	}
	return false
}

func cloneSettings(settings Settings) Settings {
	cloned := settings
	cloned.WeekdayTier = append([]RuleTier(nil), settings.WeekdayTier...)
	cloned.WeekendTier = append([]RuleTier(nil), settings.WeekendTier...)
	return cloned
}

func daysBetween(start string, end string, location *time.Location) (int, error) {
	startDate, err := time.ParseInLocation(time.DateOnly, start, location)
	if err != nil {
		return 0, fmt.Errorf("%w: invalid start date", ErrInvalidInput)
	}
	endDate, err := time.ParseInLocation(time.DateOnly, end, location)
	if err != nil {
		return 0, fmt.Errorf("%w: invalid end date", ErrInvalidInput)
	}
	days := int(endDate.Sub(startDate).Hours()/24) + 1
	if days < 1 {
		days = 1
	}
	if days > 7 {
		days = 7
	}
	return days, nil
}

func IsClientError(err error) bool {
	return errors.Is(err, ErrInvalidInput) || errors.Is(err, ErrArchivedWeek) || errors.Is(err, ErrFamilyFull) || errors.Is(err, ErrPhoneExists) || errors.Is(err, ErrExemptionLimit) || errors.Is(err, ErrExemptDay) || errors.Is(err, ErrInvalidBackup)
}
