import type { Family, FamilyBackup, FamilySession, IdentityStatus, Settings } from "./types";

export class APIError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type Envelope<T> = { data: T };

export class APIClient {
  constructor(private baseURL: string, private token = "") {}

  setToken(token: string) {
    this.token = token;
  }

  async ping(): Promise<string> {
    const result = await this.request<{ message: string }>("/ping");
    return result.message;
  }

  async defaults(): Promise<Settings> {
    return this.data<Settings>("/api/v1/default-settings");
  }

  async identify(phone: string): Promise<IdentityStatus> {
    return this.data<IdentityStatus>("/api/v1/identity/check", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
  }

  async login(phone: string): Promise<FamilySession> {
    return this.data<FamilySession>("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
  }

  async createFamily(input: { familyName: string; nickname: string; phone: string; timezone: string; settings?: Settings }): Promise<FamilySession> {
    return this.data<FamilySession>("/api/v1/families", { method: "POST", body: JSON.stringify(input) });
  }

  async joinFamily(input: { joinCode: string; nickname: string; phone: string }): Promise<FamilySession> {
    return this.data<FamilySession>("/api/v1/families/join", { method: "POST", body: JSON.stringify(input) });
  }

  async family(): Promise<Family> {
    return this.data<Family>("/api/v1/family");
  }

  async exportFamily(): Promise<FamilyBackup> {
    return this.data<FamilyBackup>("/api/v1/family/export");
  }

  async restoreFamily(backup: FamilyBackup): Promise<Family> {
    return this.data<Family>("/api/v1/family/restore", {
      method: "POST",
      body: JSON.stringify(backup),
    });
  }

  async checkInNow(): Promise<Family> {
    return this.data<Family>("/api/v1/checkins/now", { method: "PUT" });
  }

  async saveCheckin(date: string, time: string): Promise<Family> {
    return this.data<Family>(`/api/v1/checkins/${date}`, {
      method: "PUT",
      body: JSON.stringify({ time, source: "backfill" }),
    });
  }

  async deleteCheckin(date: string): Promise<Family> {
    return this.data<Family>(`/api/v1/checkins/${date}`, { method: "DELETE" });
  }

  async reviewCheckinChange(changeID: string, approve: boolean): Promise<Family> {
    const action = approve ? "approve" : "reject";
    return this.data<Family>(`/api/v1/checkin-changes/${changeID}/${action}`, { method: "POST" });
  }

  async requestExemption(date: string): Promise<Family> {
    return this.data<Family>("/api/v1/exemptions", {
      method: "POST",
      body: JSON.stringify({ date }),
    });
  }

  async reviewExemptionChange(changeID: string, approve: boolean): Promise<Family> {
    const action = approve ? "approve" : "reject";
    return this.data<Family>(`/api/v1/exemption-changes/${changeID}/${action}`, { method: "POST" });
  }

  async completeRewardReview(): Promise<Family> {
    return this.data<Family>("/api/v1/reward-review/complete", { method: "POST" });
  }

  async saveSettings(settings: Settings): Promise<Family> {
    return this.data<Family>("/api/v1/family/settings", {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
  }

  private async data<T>(path: string, options?: RequestInit): Promise<T> {
    const result = await this.request<Envelope<T>>(path, options);
    return result.data;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    let response: Response;
    try {
      response = await fetch(`${this.baseURL.replace(/\/$/, "")}${path}`, { ...options, headers });
    } catch {
      throw new APIError("network_error", "无法连接后端，请检查地址和网络");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new APIError(payload?.error?.code ?? "request_failed", payload?.error?.message ?? "请求失败");
    }
    return payload as T;
  }
}
