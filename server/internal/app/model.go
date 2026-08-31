package app

import "time"

const (
	RoleOwner                = "owner"
	RoleMember               = "member"
	CurrentRewardRuleVersion = "v4"
	LegacyRewardRuleVersion  = "v3"
	LegacyWeekCalendar       = "monday-v1"
	CurrentWeekCalendar      = "sunday-v2"
	CutoverWeekCalendar      = "cutover-v2"
	CurrentFamilyVersion     = 7
)

type RuleTier struct {
	End   string  `json:"end"`
	Score float64 `json:"score"`
	Fine  int     `json:"fine"`
}

type Settings struct {
	IdealTime   string     `json:"idealTime"`
	CutoffHour  int        `json:"cutoffHour"`
	WeekdayTier []RuleTier `json:"weekdayTiers"`
	WeekendTier []RuleTier `json:"weekendTiers"`
	RewardNote  string     `json:"rewardNote"`
}

type Member struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Role            string     `json:"role"`
	Phone           string     `json:"phone"`
	PhoneVerifiedAt *time.Time `json:"phoneVerifiedAt,omitempty"`
	TokenHash       string     `json:"tokenHash"`
	JoinedAt        time.Time  `json:"joinedAt"`
}

type Checkin struct {
	Time      string    `json:"time"`
	Source    string    `json:"source"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const CheckinChangeUpsert = "upsert"

type CheckinChange struct {
	ID           string    `json:"id"`
	WeekStart    string    `json:"weekStart"`
	Date         string    `json:"date"`
	MemberID     string    `json:"memberId"`
	RequestedBy  string    `json:"requestedBy"`
	Kind         string    `json:"kind"`
	OriginalTime string    `json:"originalTime,omitempty"`
	ProposedTime string    `json:"proposedTime,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Exemption struct {
	Date       string    `json:"date"`
	MemberID   string    `json:"memberId"`
	ApprovedAt time.Time `json:"approvedAt"`
}

type ExemptionChange struct {
	ID          string    `json:"id"`
	WeekStart   string    `json:"weekStart"`
	Date        string    `json:"date"`
	MemberID    string    `json:"memberId"`
	RequestedBy string    `json:"requestedBy"`
	CreatedAt   time.Time `json:"createdAt"`
}

type ActiveWeek struct {
	WeekStart         string                          `json:"weekStart"`
	WeekEnd           string                          `json:"weekEnd"`
	WeekCalendar      string                          `json:"weekCalendar,omitempty"`
	RewardRuleVersion string                          `json:"rewardRuleVersion"`
	Settings          Settings                        `json:"settings"`
	Checkins          map[string]map[string]Checkin   `json:"checkins"`
	Exemptions        map[string]map[string]Exemption `json:"exemptions,omitempty"`
}

type DailyMemberResult struct {
	Time   string  `json:"time"`
	Score  float64 `json:"score"`
	Fine   int     `json:"fine"`
	Source string  `json:"source"`
	Exempt bool    `json:"exempt,omitempty"`
}

type RewardReviewStatus struct {
	CycleStartedAt time.Time `json:"cycleStartedAt"`
	NextReviewAt   time.Time `json:"nextReviewAt"`
	Due            bool      `json:"due"`
	DaysRemaining  int       `json:"daysRemaining"`
}

type DailyResult struct {
	Date    string                       `json:"date"`
	Members map[string]DailyMemberResult `json:"members"`
}

type MemberSummary struct {
	TotalScore       float64 `json:"totalScore"`
	TotalFine        int     `json:"totalFine"`
	CheckinDays      int     `json:"checkinDays"`
	AverageSleepTime string  `json:"averageSleepTime"`
}

type WeekSummary struct {
	Members         map[string]MemberSummary `json:"members"`
	CompletionRate  int                      `json:"completionRate"`
	TotalCheckins   int                      `json:"totalCheckins"`
	ExpectedCheckin int                      `json:"expectedCheckins"`
}

type WeeklyArchive struct {
	WeekStart          string        `json:"weekStart"`
	WeekEnd            string        `json:"weekEnd"`
	WeekCalendar       string        `json:"weekCalendar,omitempty"`
	RewardRuleVersion  string        `json:"rewardRuleVersion"`
	ArchivedAt         time.Time     `json:"archivedAt"`
	SettingsSnapshot   Settings      `json:"settingsSnapshot"`
	DailySnapshot      []DailyResult `json:"dailySnapshot"`
	Summary            WeekSummary   `json:"summary"`
	ExemptionsSnapshot []Exemption   `json:"exemptionsSnapshot,omitempty"`
}

type Family struct {
	Version               int               `json:"version"`
	Revision              int64             `json:"revision"`
	ID                    string            `json:"id"`
	Name                  string            `json:"name"`
	Timezone              string            `json:"timezone"`
	JoinCode              string            `json:"joinCode"`
	JoinCodeHash          string            `json:"joinCodeHash"`
	CreatedAt             time.Time         `json:"createdAt"`
	Members               map[string]Member `json:"members"`
	ActiveWeek            ActiveWeek        `json:"activeWeek"`
	Archives              []WeeklyArchive   `json:"weeklyArchives"`
	Pending               []CheckinChange   `json:"pendingChanges,omitempty"`
	PendingExemptions     []ExemptionChange `json:"pendingExemptions,omitempty"`
	RewardReviewStartedAt time.Time         `json:"rewardReviewStartedAt"`
}

type MemberView struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Role  string `json:"role"`
	Phone string `json:"phone,omitempty"`
}

type ActiveWeekView struct {
	WeekStart         string        `json:"weekStart"`
	WeekEnd           string        `json:"weekEnd"`
	WeekCalendar      string        `json:"weekCalendar,omitempty"`
	RewardRuleVersion string        `json:"rewardRuleVersion"`
	Settings          Settings      `json:"settings"`
	Days              []DailyResult `json:"days"`
	Summary           WeekSummary   `json:"summary"`
}

type FamilyView struct {
	ID                string             `json:"id"`
	Name              string             `json:"name"`
	Timezone          string             `json:"timezone"`
	CurrentMember     MemberView         `json:"currentMember"`
	Members           []MemberView       `json:"members"`
	ActiveWeek        ActiveWeekView     `json:"activeWeek"`
	Archives          []WeeklyArchive    `json:"weeklyArchives"`
	Pending           []CheckinChange    `json:"pendingChanges"`
	PendingExemptions []ExemptionChange  `json:"pendingExemptions"`
	RewardReview      RewardReviewStatus `json:"rewardReview"`
}

type CreateFamilyRequest struct {
	FamilyName string    `json:"familyName"`
	Nickname   string    `json:"nickname"`
	Phone      string    `json:"phone"`
	Timezone   string    `json:"timezone"`
	Settings   *Settings `json:"settings,omitempty"`
}

type JoinFamilyRequest struct {
	JoinCode string `json:"joinCode"`
	Nickname string `json:"nickname"`
	Phone    string `json:"phone"`
}

type IdentityRequest struct {
	Phone string `json:"phone"`
}

type IdentityStatus struct {
	Exists               bool   `json:"exists"`
	Phone                string `json:"phone"`
	VerificationRequired bool   `json:"verificationRequired"`
}

type SessionRequest struct {
	Phone string `json:"phone"`
}

type UpdateMemberProfileRequest struct {
	Name string `json:"name"`
}

type FamilySession struct {
	Token    string     `json:"token"`
	JoinCode string     `json:"joinCode,omitempty"`
	Family   FamilyView `json:"family"`
}

type CheckinRequest struct {
	Time   string `json:"time"`
	Source string `json:"source"`
}

type ExemptionRequest struct {
	Date string `json:"date"`
}

type FamilyBackup struct {
	FormatVersion int       `json:"formatVersion"`
	ExportedAt    time.Time `json:"exportedAt"`
	Family        Family    `json:"family"`
}
