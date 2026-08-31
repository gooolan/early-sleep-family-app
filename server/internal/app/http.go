package app

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
)

type HTTPServer struct {
	service *Service
	logger  *slog.Logger
}

type errorResponse struct {
	Error apiError `json:"error"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func NewHTTPHandler(service *Service, logger *slog.Logger) http.Handler {
	server := &HTTPServer{service: service, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", server.ping)
	mux.HandleFunc("GET /api/v1/default-settings", server.defaultSettings)
	mux.HandleFunc("POST /api/v1/identity/check", server.identify)
	mux.HandleFunc("POST /api/v1/sessions", server.login)
	mux.HandleFunc("POST /api/v1/families", server.createFamily)
	mux.HandleFunc("POST /api/v1/families/join", server.joinFamily)
	mux.HandleFunc("GET /api/v1/family", server.getFamily)
	mux.HandleFunc("GET /api/v1/family/export", server.exportFamily)
	mux.HandleFunc("POST /api/v1/family/restore", server.restoreFamily)
	mux.HandleFunc("PATCH /api/v1/family/settings", server.updateSettings)
	mux.HandleFunc("PATCH /api/v1/members/me", server.updateMemberProfile)
	mux.HandleFunc("PUT /api/v1/checkins/now", server.checkInNow)
	mux.HandleFunc("PUT /api/v1/checkins/{date}", server.upsertCheckin)
	mux.HandleFunc("POST /api/v1/checkin-changes/{id}/approve", server.approveCheckinChange)
	mux.HandleFunc("POST /api/v1/checkin-changes/{id}/reject", server.rejectCheckinChange)
	mux.HandleFunc("POST /api/v1/checkin-changes/{id}/cancel", server.cancelCheckinChange)
	mux.HandleFunc("POST /api/v1/exemptions", server.requestExemption)
	mux.HandleFunc("POST /api/v1/exemption-changes/{id}/approve", server.approveExemptionChange)
	mux.HandleFunc("POST /api/v1/exemption-changes/{id}/reject", server.rejectExemptionChange)
	mux.HandleFunc("POST /api/v1/exemption-changes/{id}/cancel", server.cancelExemptionChange)
	mux.HandleFunc("POST /api/v1/reward-review/complete", server.completeRewardReview)
	return server.middleware(mux)
}

func (server *HTTPServer) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Access-Control-Allow-Origin", "*")
		writer.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS")
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		if request.Method == http.MethodOptions {
			writer.WriteHeader(http.StatusNoContent)
			return
		}

		defer func() {
			recovered := recover()
			if recovered == nil {
				return
			}
			server.logger.ErrorContext(request.Context(), "request panic", "error", recovered)
			writeError(writer, http.StatusInternalServerError, "internal_error", "服务器内部错误")
		}()
		next.ServeHTTP(writer, request)
	})
}

func (server *HTTPServer) ping(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"message": "pong"})
}

func (server *HTTPServer) defaultSettings(writer http.ResponseWriter, _ *http.Request) {
	writeData(writer, http.StatusOK, DefaultSettings())
}

func (server *HTTPServer) identify(writer http.ResponseWriter, request *http.Request) {
	var input IdentityRequest
	err := decodeJSON(writer, request, &input)
	if err != nil {
		return
	}
	status, err := server.service.Identify(request.Context(), input)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, status)
}

func (server *HTTPServer) login(writer http.ResponseWriter, request *http.Request) {
	var input SessionRequest
	err := decodeJSON(writer, request, &input)
	if err != nil {
		return
	}
	session, err := server.service.Login(request.Context(), input)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, session)
}

func (server *HTTPServer) createFamily(writer http.ResponseWriter, request *http.Request) {
	var input CreateFamilyRequest
	err := decodeJSON(writer, request, &input)
	if err != nil {
		return
	}
	session, err := server.service.CreateFamily(request.Context(), input)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusCreated, session)
}

func (server *HTTPServer) joinFamily(writer http.ResponseWriter, request *http.Request) {
	var input JoinFamilyRequest
	err := decodeJSON(writer, request, &input)
	if err != nil {
		return
	}
	session, err := server.service.JoinFamily(request.Context(), input)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, session)
}

func (server *HTTPServer) getFamily(writer http.ResponseWriter, request *http.Request) {
	family, err := server.service.GetFamily(request.Context(), bearerToken(request))
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) exportFamily(writer http.ResponseWriter, request *http.Request) {
	backup, err := server.service.ExportFamily(request.Context(), bearerToken(request))
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, backup)
}

func (server *HTTPServer) restoreFamily(writer http.ResponseWriter, request *http.Request) {
	var backup FamilyBackup
	err := decodeJSONWithLimit(writer, request, &backup, 16<<20)
	if err != nil {
		return
	}
	family, err := server.service.RestoreFamily(request.Context(), bearerToken(request), backup)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) updateSettings(writer http.ResponseWriter, request *http.Request) {
	var input Settings
	err := decodeJSON(writer, request, &input)
	if err != nil {
		return
	}
	family, err := server.service.UpdateSettings(request.Context(), bearerToken(request), input)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) updateMemberProfile(writer http.ResponseWriter, request *http.Request) {
	var input UpdateMemberProfileRequest
	err := decodeJSON(writer, request, &input)
	if err != nil {
		return
	}
	family, err := server.service.UpdateMemberProfile(request.Context(), bearerToken(request), input)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) checkInNow(writer http.ResponseWriter, request *http.Request) {
	family, err := server.service.CheckInNow(request.Context(), bearerToken(request))
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) upsertCheckin(writer http.ResponseWriter, request *http.Request) {
	var input CheckinRequest
	err := decodeJSON(writer, request, &input)
	if err != nil {
		return
	}
	family, err := server.service.UpsertCheckin(request.Context(), bearerToken(request), request.PathValue("date"), input)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) approveCheckinChange(writer http.ResponseWriter, request *http.Request) {
	family, err := server.service.ReviewCheckinChange(request.Context(), bearerToken(request), request.PathValue("id"), true)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) rejectCheckinChange(writer http.ResponseWriter, request *http.Request) {
	family, err := server.service.ReviewCheckinChange(request.Context(), bearerToken(request), request.PathValue("id"), false)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) cancelCheckinChange(writer http.ResponseWriter, request *http.Request) {
	family, err := server.service.CancelCheckinChange(request.Context(), bearerToken(request), request.PathValue("id"))
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) requestExemption(writer http.ResponseWriter, request *http.Request) {
	var input ExemptionRequest
	err := decodeJSON(writer, request, &input)
	if err != nil {
		return
	}
	family, err := server.service.RequestExemption(request.Context(), bearerToken(request), input)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) approveExemptionChange(writer http.ResponseWriter, request *http.Request) {
	family, err := server.service.ReviewExemptionChange(request.Context(), bearerToken(request), request.PathValue("id"), true)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) rejectExemptionChange(writer http.ResponseWriter, request *http.Request) {
	family, err := server.service.ReviewExemptionChange(request.Context(), bearerToken(request), request.PathValue("id"), false)
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) cancelExemptionChange(writer http.ResponseWriter, request *http.Request) {
	family, err := server.service.CancelExemptionChange(request.Context(), bearerToken(request), request.PathValue("id"))
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) completeRewardReview(writer http.ResponseWriter, request *http.Request) {
	family, err := server.service.CompleteRewardReview(request.Context(), bearerToken(request))
	if err != nil {
		server.handleError(writer, request, err)
		return
	}
	writeData(writer, http.StatusOK, family)
}

func (server *HTTPServer) handleError(writer http.ResponseWriter, request *http.Request, err error) {
	status := http.StatusInternalServerError
	code := "internal_error"
	message := "服务器内部错误"

	switch {
	case errors.Is(err, ErrUnauthorized):
		status, code, message = http.StatusUnauthorized, "unauthorized", "成员凭证无效，请使用手机号重新登录"
	case errors.Is(err, ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "用户、家庭或邀请码不存在"
	case errors.Is(err, ErrPhoneExists):
		status, code, message = http.StatusConflict, "phone_exists", "这个手机号已经绑定用户，请直接登录"
	case errors.Is(err, ErrFamilyFull):
		status, code, message = http.StatusConflict, "family_full", "这个家庭已经有两名成员"
	case errors.Is(err, ErrArchivedWeek):
		status, code, message = http.StatusConflict, "archived_week", "只能修改当前周的记录"
	case errors.Is(err, ErrSelfApproval):
		status, code, message = http.StatusConflict, "self_approval", "不能确认自己发起的修改，请等待对方处理"
	case errors.Is(err, ErrNotRequester):
		status, code, message = http.StatusConflict, "not_requester", "只有申请发起人可以撤回"
	case errors.Is(err, ErrFutureDate):
		status, code, message = http.StatusConflict, "future_date", "日期尚未到达，不能补卡或申请豁免"
	case errors.Is(err, ErrExemptionLimit):
		status, code, message = http.StatusConflict, "exemption_limit", "每人每月最多使用 2 次特殊情况豁免"
	case errors.Is(err, ErrExemptDay):
		status, code, message = http.StatusConflict, "exempt_day", "这一天已经通过特殊情况豁免，不能再修改打卡"
	case errors.Is(err, ErrInvalidBackup):
		status, code, message = http.StatusBadRequest, "invalid_backup", "备份文件无效、家庭不匹配或版本不受支持"
	case errors.Is(err, ErrInvalidInput):
		status, code, message = http.StatusBadRequest, "invalid_input", "参数不符合要求，请检查填写内容、时间与计分档位"
	default:
		server.logger.ErrorContext(request.Context(), "request failed", "method", request.Method, "path", request.URL.Path, "error", err)
	}
	writeError(writer, status, code, message)
}

func bearerToken(request *http.Request) string {
	value := strings.TrimSpace(request.Header.Get("Authorization"))
	prefix := "Bearer "
	if !strings.HasPrefix(value, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(value, prefix))
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, destination any) error {
	return decodeJSONWithLimit(writer, request, destination, 1<<20)
}

func decodeJSONWithLimit(writer http.ResponseWriter, request *http.Request, destination any, limit int64) error {
	request.Body = http.MaxBytesReader(writer, request.Body, limit)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	err := decoder.Decode(destination)
	if err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_json", "请求内容不是有效的 JSON")
		return err
	}
	return nil
}

func writeData(writer http.ResponseWriter, status int, data any) {
	writeJSON(writer, status, map[string]any{"data": data})
}

func writeError(writer http.ResponseWriter, status int, code string, message string) {
	writeJSON(writer, status, errorResponse{Error: apiError{Code: code, Message: message}})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.WriteHeader(status)
	err := json.NewEncoder(writer).Encode(value)
	if err != nil {
		slog.Error("encode HTTP response", "error", err)
	}
}
