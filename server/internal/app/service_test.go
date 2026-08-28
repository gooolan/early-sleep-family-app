package app

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestFamilyFlowRecalculatesCurrentWeekAndArchivesOnNextWeekWrite(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	current := time.Date(2026, 8, 24, 23, 0, 0, 0, location)
	service.now = func() time.Time { return current }

	session, err := service.CreateFamily(context.Background(), CreateFamilyRequest{
		FamilyName: "早睡家庭",
		Nickname:   "甲",
		Phone:      "13800138000",
		Timezone:   "Asia/Shanghai",
	})
	if err != nil {
		t.Fatal(err)
	}
	if session.Family.Archives == nil {
		t.Fatal("empty weekly archives must be encoded as an array")
	}
	_, err = service.UpsertCheckin(context.Background(), session.Token, "2026-08-24", CheckinRequest{Time: "23:00", Source: "backfill"})
	if err != nil {
		t.Fatal(err)
	}

	settings := DefaultSettings()
	settings.WeekdayTier[1].Score = 9
	settings.RewardNote = "个人达到目标后向共同账户存入奖励金"
	view, err := service.UpdateSettings(context.Background(), session.Token, settings)
	if err != nil {
		t.Fatal(err)
	}
	memberSummary := view.ActiveWeek.Summary.Members[view.CurrentMember.ID]
	if memberSummary.TotalScore != 9 {
		t.Fatalf("recalculated score = %d, want 9", memberSummary.TotalScore)
	}

	current = time.Date(2026, 8, 31, 23, 0, 0, 0, location)
	view, err = service.CheckInNow(context.Background(), session.Token)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Archives) != 1 {
		t.Fatalf("archive count = %d, want 1", len(view.Archives))
	}
	archived := view.Archives[0]
	if archived.Summary.Members[view.CurrentMember.ID].TotalScore != 9 {
		t.Fatal("archived week did not freeze recalculated score")
	}
	if archived.SettingsSnapshot.RewardNote != settings.RewardNote {
		t.Fatal("archived week did not freeze reward note")
	}

	_, err = service.UpsertCheckin(context.Background(), session.Token, "2026-08-24", CheckinRequest{Time: "22:00"})
	if !errors.Is(err, ErrArchivedWeek) {
		t.Fatalf("old-week edit error = %v, want ErrArchivedWeek", err)
	}
}

func TestGetFamilyAdvancesToCurrentWeek(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	current := time.Date(2026, 8, 30, 23, 0, 0, 0, location)
	service.now = func() time.Time { return current }

	session, err := service.CreateFamily(context.Background(), CreateFamilyRequest{FamilyName: "自动新周", Nickname: "甲", Phone: "13800138901", Timezone: "Asia/Shanghai"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.CheckInNow(context.Background(), session.Token)
	if err != nil {
		t.Fatal(err)
	}

	current = time.Date(2026, 8, 31, 9, 0, 0, 0, location)
	view, err := service.GetFamily(context.Background(), session.Token)
	if err != nil {
		t.Fatal(err)
	}
	if view.ActiveWeek.WeekStart != "2026-08-31" || view.ActiveWeek.WeekEnd != "2026-09-06" {
		t.Fatalf("active week = %s..%s", view.ActiveWeek.WeekStart, view.ActiveWeek.WeekEnd)
	}
	if len(view.Archives) != 1 || view.Archives[0].WeekStart != "2026-08-24" {
		t.Fatalf("archives = %+v", view.Archives)
	}
}

func TestCurrentWeekCompletionUsesElapsedDaysAndArchiveUsesFullWeek(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	current := time.Date(2026, 8, 24, 23, 0, 0, 0, location)
	service.now = func() time.Time { return current }

	session, err := service.CreateFamily(context.Background(), CreateFamilyRequest{FamilyName: "完成度", Nickname: "甲", Phone: "13800138911", Timezone: "Asia/Shanghai"})
	if err != nil {
		t.Fatal(err)
	}
	view, err := service.CheckInNow(context.Background(), session.Token)
	if err != nil {
		t.Fatal(err)
	}
	if view.ActiveWeek.RewardRuleVersion != CurrentRewardRuleVersion {
		t.Fatalf("reward rule version = %s", view.ActiveWeek.RewardRuleVersion)
	}

	current = time.Date(2026, 8, 26, 23, 0, 0, 0, location)
	view, err = service.GetFamily(context.Background(), session.Token)
	if err != nil {
		t.Fatal(err)
	}
	if view.ActiveWeek.Summary.ExpectedCheckin != 3 || view.ActiveWeek.Summary.CompletionRate != 33 {
		t.Fatalf("current completion = %+v, want 1/3", view.ActiveWeek.Summary)
	}

	current = time.Date(2026, 8, 31, 9, 0, 0, 0, location)
	view, err = service.GetFamily(context.Background(), session.Token)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Archives) != 1 {
		t.Fatalf("archive count = %d, want 1", len(view.Archives))
	}
	archive := view.Archives[0]
	if archive.Summary.ExpectedCheckin != 7 || archive.Summary.CompletionRate != 14 {
		t.Fatalf("archived completion = %+v, want 1/7", archive.Summary)
	}
	if archive.RewardRuleVersion != CurrentRewardRuleVersion {
		t.Fatalf("archived reward rule version = %s", archive.RewardRuleVersion)
	}
}

func TestFamilyBackupRestoresDataWithoutReplacingCredentials(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	service.now = func() time.Time {
		return time.Date(2026, 8, 26, 22, 30, 0, 0, location)
	}

	owner, err := service.CreateFamily(context.Background(), CreateFamilyRequest{FamilyName: "备份家庭", Nickname: "甲", Phone: "13800138921", Timezone: "Asia/Shanghai"})
	if err != nil {
		t.Fatal(err)
	}
	partner, err := service.JoinFamily(context.Background(), JoinFamilyRequest{JoinCode: owner.JoinCode, Nickname: "乙", Phone: "13800138922"})
	if err != nil {
		t.Fatal(err)
	}
	backup, err := service.ExportFamily(context.Background(), owner.Token)
	if err != nil {
		t.Fatal(err)
	}
	if backup.FormatVersion != currentBackupFormatVersion || backup.Family.JoinCodeHash != "" {
		t.Fatalf("backup metadata = %+v", backup)
	}
	for _, member := range backup.Family.Members {
		if member.TokenHash != "" {
			t.Fatal("backup contains a member token hash")
		}
	}

	settings := backup.Family.ActiveWeek.Settings
	settings.RewardNote = "已修改"
	_, err = service.UpdateSettings(context.Background(), owner.Token, settings)
	if err != nil {
		t.Fatal(err)
	}
	view, err := service.RestoreFamily(context.Background(), owner.Token, backup)
	if err != nil {
		t.Fatal(err)
	}
	if view.ActiveWeek.Settings.RewardNote != backup.Family.ActiveWeek.Settings.RewardNote {
		t.Fatal("restore did not recover the exported settings")
	}
	_, err = service.GetFamily(context.Background(), owner.Token)
	if err != nil {
		t.Fatalf("owner token was replaced during restore: %v", err)
	}
	_, err = service.GetFamily(context.Background(), partner.Token)
	if err != nil {
		t.Fatalf("partner token was replaced during restore: %v", err)
	}
	_, err = service.RestoreFamily(context.Background(), partner.Token, backup)
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("member restore error = %v, want ErrUnauthorized", err)
	}

	backup.Family.ID = "fam_other"
	_, err = service.RestoreFamily(context.Background(), owner.Token, backup)
	if !errors.Is(err, ErrInvalidBackup) {
		t.Fatalf("mismatched backup error = %v, want ErrInvalidBackup", err)
	}
}

func TestJoinFamilyStopsAtTwoMembers(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	session, err := service.CreateFamily(context.Background(), CreateFamilyRequest{FamilyName: "两个人", Nickname: "甲", Phone: "13800138001"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.JoinFamily(context.Background(), JoinFamilyRequest{JoinCode: session.JoinCode, Nickname: "乙", Phone: "13800138002"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.JoinFamily(context.Background(), JoinFamilyRequest{JoinCode: session.JoinCode, Nickname: "丙", Phone: "13800138003"})
	if !errors.Is(err, ErrFamilyFull) {
		t.Fatalf("third join error = %v, want ErrFamilyFull", err)
	}
}

func TestManualCheckinRequiresPartnerApproval(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	service.now = func() time.Time {
		return time.Date(2026, 8, 26, 22, 30, 0, 0, location)
	}

	owner, err := service.CreateFamily(context.Background(), CreateFamilyRequest{FamilyName: "共同确认", Nickname: "甲", Phone: "13800138011", Timezone: "Asia/Shanghai"})
	if err != nil {
		t.Fatal(err)
	}
	partner, err := service.JoinFamily(context.Background(), JoinFamilyRequest{JoinCode: owner.JoinCode, Nickname: "乙", Phone: "13800138012"})
	if err != nil {
		t.Fatal(err)
	}

	view, err := service.UpsertCheckin(context.Background(), owner.Token, "2026-08-26", CheckinRequest{Time: "23:20", Source: "backfill"})
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Pending) != 1 {
		t.Fatalf("pending count = %d, want 1", len(view.Pending))
	}
	if len(view.ActiveWeek.Days) != 0 {
		t.Fatal("manual checkin changed scores before approval")
	}

	changeID := view.Pending[0].ID
	_, err = service.CancelCheckinChange(context.Background(), partner.Token, changeID)
	if !errors.Is(err, ErrNotRequester) {
		t.Fatalf("partner cancel error = %v, want ErrNotRequester", err)
	}
	view, err = service.CancelCheckinChange(context.Background(), owner.Token, changeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Pending) != 0 {
		t.Fatalf("pending count after cancellation = %d, want 0", len(view.Pending))
	}
	view, err = service.UpsertCheckin(context.Background(), owner.Token, "2026-08-26", CheckinRequest{Time: "23:20", Source: "backfill"})
	if err != nil {
		t.Fatal(err)
	}
	changeID = view.Pending[0].ID
	_, err = service.ReviewCheckinChange(context.Background(), owner.Token, changeID, true)
	if !errors.Is(err, ErrSelfApproval) {
		t.Fatalf("self review error = %v, want ErrSelfApproval", err)
	}
	view, err = service.ReviewCheckinChange(context.Background(), partner.Token, changeID, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Pending) != 0 {
		t.Fatalf("pending count after approval = %d, want 0", len(view.Pending))
	}
	if len(view.ActiveWeek.Days) != 1 {
		t.Fatalf("active day count = %d, want 1", len(view.ActiveWeek.Days))
	}
	result := view.ActiveWeek.Days[0].Members[owner.Family.CurrentMember.ID]
	if result.Time != "23:20" || result.Score != 1 {
		t.Fatalf("approved result = %+v", result)
	}

	view, err = service.UpsertCheckin(context.Background(), partner.Token, "2026-08-26", CheckinRequest{Time: "00:20", Source: "backfill"})
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Pending) != 1 {
		t.Fatalf("partner pending count = %d, want 1", len(view.Pending))
	}
	view, err = service.ReviewCheckinChange(context.Background(), owner.Token, view.Pending[0].ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Pending) != 0 || view.ActiveWeek.Summary.TotalCheckins != 1 {
		t.Fatal("rejected change affected active week")
	}

	_, err = service.UpsertCheckin(context.Background(), owner.Token, "2026-08-27", CheckinRequest{Time: "23:00", Source: "backfill"})
	if !errors.Is(err, ErrFutureDate) {
		t.Fatalf("future checkin error = %v, want ErrFutureDate", err)
	}
}

func TestExemptionRequiresPartnerApprovalAndFreezesInArchive(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	current := time.Date(2026, 8, 26, 22, 30, 0, 0, location)
	service.now = func() time.Time { return current }

	owner, err := service.CreateFamily(context.Background(), CreateFamilyRequest{FamilyName: "特殊情况", Nickname: "甲", Phone: "13800138111", Timezone: "Asia/Shanghai"})
	if err != nil {
		t.Fatal(err)
	}
	partner, err := service.JoinFamily(context.Background(), JoinFamilyRequest{JoinCode: owner.JoinCode, Nickname: "乙", Phone: "13800138112"})
	if err != nil {
		t.Fatal(err)
	}

	view, err := service.RequestExemption(context.Background(), owner.Token, ExemptionRequest{Date: "2026-08-24"})
	if err != nil {
		t.Fatal(err)
	}
	if len(view.PendingExemptions) != 1 || len(view.ActiveWeek.Days) != 0 {
		t.Fatal("pending exemption affected scores before approval")
	}
	changeID := view.PendingExemptions[0].ID
	_, err = service.CancelExemptionChange(context.Background(), partner.Token, changeID)
	if !errors.Is(err, ErrNotRequester) {
		t.Fatalf("partner exemption cancel error = %v, want ErrNotRequester", err)
	}
	view, err = service.CancelExemptionChange(context.Background(), owner.Token, changeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.PendingExemptions) != 0 {
		t.Fatalf("pending exemption count after cancellation = %d, want 0", len(view.PendingExemptions))
	}
	view, err = service.RequestExemption(context.Background(), owner.Token, ExemptionRequest{Date: "2026-08-24"})
	if err != nil {
		t.Fatal(err)
	}
	changeID = view.PendingExemptions[0].ID
	_, err = service.ReviewExemptionChange(context.Background(), owner.Token, changeID, true)
	if !errors.Is(err, ErrSelfApproval) {
		t.Fatalf("self review error = %v, want ErrSelfApproval", err)
	}
	view, err = service.ReviewExemptionChange(context.Background(), partner.Token, changeID, true)
	if err != nil {
		t.Fatal(err)
	}
	result := view.ActiveWeek.Days[0].Members[owner.Family.CurrentMember.ID]
	if !result.Exempt || result.Score != 0 || result.Fine != 0 {
		t.Fatalf("approved exemption = %+v", result)
	}
	_, err = service.UpsertCheckin(context.Background(), owner.Token, "2026-08-24", CheckinRequest{Time: "23:00", Source: "backfill"})
	if !errors.Is(err, ErrExemptDay) {
		t.Fatalf("exempt-day edit error = %v, want ErrExemptDay", err)
	}
	_, err = service.RequestExemption(context.Background(), owner.Token, ExemptionRequest{Date: "2026-08-27"})
	if !errors.Is(err, ErrFutureDate) {
		t.Fatalf("future exemption error = %v, want ErrFutureDate", err)
	}

	view, err = service.RequestExemption(context.Background(), owner.Token, ExemptionRequest{Date: "2026-08-25"})
	if err != nil {
		t.Fatal(err)
	}
	view, err = service.ReviewExemptionChange(context.Background(), partner.Token, view.PendingExemptions[0].ID, true)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.RequestExemption(context.Background(), owner.Token, ExemptionRequest{Date: "2026-08-26"})
	if !errors.Is(err, ErrExemptionLimit) {
		t.Fatalf("third exemption error = %v, want ErrExemptionLimit", err)
	}

	current = time.Date(2026, 8, 31, 23, 0, 0, 0, location)
	view, err = service.CheckInNow(context.Background(), owner.Token)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Archives) != 1 || len(view.Archives[0].ExemptionsSnapshot) != 2 {
		t.Fatalf("archived exemptions = %+v", view.Archives)
	}
	if view.Archives[0].Summary.Members[owner.Family.CurrentMember.ID].CheckinDays != 2 {
		t.Fatal("archive did not freeze exemption summary")
	}
}

func TestRewardReviewReminderCanOnlyBeCompletedByOwner(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	current := time.Date(2026, 8, 1, 10, 0, 0, 0, location)
	service.now = func() time.Time { return current }

	owner, err := service.CreateFamily(context.Background(), CreateFamilyRequest{FamilyName: "复盘家庭", Nickname: "甲", Phone: "13800138211", Timezone: "Asia/Shanghai"})
	if err != nil {
		t.Fatal(err)
	}
	partner, err := service.JoinFamily(context.Background(), JoinFamilyRequest{JoinCode: owner.JoinCode, Nickname: "乙", Phone: "13800138212"})
	if err != nil {
		t.Fatal(err)
	}
	current = time.Date(2026, 8, 31, 10, 0, 0, 0, location)
	view, err := service.GetFamily(context.Background(), owner.Token)
	if err != nil {
		t.Fatal(err)
	}
	if !view.RewardReview.Due || view.RewardReview.DaysRemaining != 0 {
		t.Fatalf("review status = %+v, want due", view.RewardReview)
	}
	_, err = service.CompleteRewardReview(context.Background(), partner.Token)
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("member completion error = %v, want ErrUnauthorized", err)
	}
	view, err = service.CompleteRewardReview(context.Background(), owner.Token)
	if err != nil {
		t.Fatal(err)
	}
	if view.RewardReview.Due || view.RewardReview.DaysRemaining != 30 {
		t.Fatalf("reset review status = %+v", view.RewardReview)
	}
}

func TestPhoneLoginRestoresMemberAndRotatesToken(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	created, err := service.CreateFamily(context.Background(), CreateFamilyRequest{
		FamilyName: "重新安装",
		Nickname:   "甲",
		Phone:      "138 0013 8004",
	})
	if err != nil {
		t.Fatal(err)
	}

	status, err := service.Identify(context.Background(), IdentityRequest{Phone: "+86 13800138004"})
	if err != nil {
		t.Fatal(err)
	}
	if !status.Exists || status.Phone != "+8613800138004" {
		t.Fatalf("identity status = %+v", status)
	}

	restored, err := service.Login(context.Background(), SessionRequest{Phone: "13800138004"})
	if err != nil {
		t.Fatal(err)
	}
	if restored.Family.CurrentMember.ID != created.Family.CurrentMember.ID {
		t.Fatal("login did not restore the original member")
	}
	if restored.Family.CurrentMember.Phone != "+8613800138004" {
		t.Fatalf("current phone = %s", restored.Family.CurrentMember.Phone)
	}
	_, err = service.GetFamily(context.Background(), created.Token)
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("old token error = %v, want ErrUnauthorized", err)
	}
	_, err = service.GetFamily(context.Background(), restored.Token)
	if err != nil {
		t.Fatalf("new token failed: %v", err)
	}
}

func TestPhoneCanOnlyBelongToOneMember(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store)
	_, err = service.CreateFamily(context.Background(), CreateFamilyRequest{FamilyName: "家庭一", Nickname: "甲", Phone: "13800138005"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.CreateFamily(context.Background(), CreateFamilyRequest{FamilyName: "家庭二", Nickname: "乙", Phone: "+8613800138005"})
	if !errors.Is(err, ErrPhoneExists) {
		t.Fatalf("duplicate phone error = %v, want ErrPhoneExists", err)
	}
}
