// AC-69 test aracı (mimari §5.1, §9): uygulamadaki TÜM uçları onRoute ile toplar; her uç burada
// sınıflandırılmak zorundadır (sınıfsız uç → test kırmızı). Sınıflar:
//  - public: kimliksiz (ops, login, public müşteri uçları)
//  - self:   oturumlu ama tenant kaydı hedeflemeyen uç → B kullanıcısının yanıtında A tenant'ının hiçbir id'si olmamalı
//  - tenant: tenant kaydı hedefleyen uç → CROSS_TENANT_CASES'te A'nın kaydına B ile istek = 404
//  - list:   tenant kayıtlarını listeleyen GET → B'nin yanıtı kendi kaydını içerir, A'nınkini içermez
// Yeni paket uç eklediğinde ROUTE_CLASSES + (tenant ise) CROSS_TENANT_CASES'e satır ekler.
import type { FastifyInstance, InjectOptions } from "fastify";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, testDb, type TestUser } from "./app.ts";
import { createCustomerRow, createRequestRow } from "./requests.ts";
import { codeRow, createDeviceRow } from "./unattended.ts";

// P8b: "scoped" = tenantScope'lu koleksiyon/ayar ucu (id'siz); izolasyonu requests-p8b.test.ts ("AC-147/148") ve
// requests-p8b-5.test.ts ("AC-147", "AC-148: Super Admin", "AC-129") test eder.
// P9: "system" = yalnız SUPER_ADMIN (/admin/*); tenant kullanıcısı (ADMIN dahil) → 403 (tenant-isolation.test.ts).
export type RouteClass = "public" | "self" | "tenant" | "list" | "scoped" | "system";

export const ROUTE_CLASSES: Record<string, RouteClass> = {
  // P28c çoklu teknisyen: oturum uçları B → A oturumu 404 (ownedRoom/supervise); davet kimliği uçları kullanıcının kendi
  // daveti (başkasınınki 410 INVITE_GONE, kimlik sızmaz — multi-p28c.test.ts); aktif liste tenantScope'lu.
  "GET /api/v1/sessions/invites": "self",
  "POST /api/v1/sessions/invites/:inviteId/accept": "self",
  "POST /api/v1/sessions/invites/:inviteId/reject": "self",
  "GET /api/v1/sessions/active": "scoped",
  "POST /api/v1/sessions/:id/supervise": "tenant",
  "GET /api/v1/sessions/:id/invite-candidates": "tenant",
  "POST /api/v1/sessions/:id/invites": "tenant",
  "GET /api/v1/sessions/:id/invites": "tenant",
  "DELETE /api/v1/sessions/:id/invites/:inviteId": "tenant",
  // P27-K3: gözetimsiz bağlantı (B'nin A cihazına isteği → 404; IDOR, AC-293).
  "POST /api/v1/unattended/devices/:id/connect": "tenant",
  // P28u-K4: müdahale (B'nin A oturumuna isteği → 404, AC-442).
  "POST /api/v1/sessions/:id/unattended/lock": "tenant",
  "POST /api/v1/sessions/:id/unattended/logoff": "tenant",
  // P28u-K3: firma politikası (tenantScope'lu, kimliksiz yol).
  // P27-K2: koleksiyon/durum uçları tenantScope'lu (liste izolasyonu: unattended-api.test.ts "AC-293"); kayıt ucu kimliksiz
  // (kayıt kodu kimliği); id'li uçlar B → A kaydı 404.
  "GET /api/v1/unattended/status": "scoped",
  "GET /api/v1/unattended/devices": "scoped",
  "GET /api/v1/unattended/registration-codes": "scoped",
  "POST /api/v1/unattended/registration-codes": "scoped",
  "GET /api/v1/unattended/download": "scoped",
  "POST /api/v1/unattended/register": "public",
  // LG (mimari-link-gonderme §4.2): hedef kimliği gövdede (tenantScope'lu); başka firmanın oturum/kod/müşterisi → 404
  // lg-send.test.ts ("AC-415/416/D-LG-5", "AC-421/423", "AC-413/414"). Public indirme kimliksiz (belirteç).
  "POST /api/v1/customer-send": "scoped",
  "POST /api/v1/customer-send/options": "scoped",
  "GET /api/v1/public/unattended/download": "public",
  "GET /api/v1/unattended/devices/:id": "tenant",
  "PUT /api/v1/unattended/devices/:id/grants": "tenant",
  "POST /api/v1/unattended/devices/:id/revoke": "tenant",
  "DELETE /api/v1/unattended/registration-codes/:id": "tenant",
  "GET /api/v1/unattended/customers/:customerId/contacts": "tenant",
  "PUT /api/v1/unattended/customers/:customerId/contacts": "tenant",
  "GET /health": "public",
  "GET /ready": "public",
  "POST /api/v1/auth/login": "public",
  "POST /api/v1/auth/logout": "self",
  "POST /api/v1/auth/password/change": "self",
  "GET /api/v1/auth/me": "self",
  // P10 (AC-66..68): kendi hesabı / public sıfırlama; SMTP testi ve e-posta kanal testi tenantScope'lu
  "POST /api/v1/auth/mfa/verify": "self",
  "POST /api/v1/auth/mfa/setup": "self",
  "POST /api/v1/auth/mfa/enable": "self",
  "POST /api/v1/auth/logout-all": "self",
  "POST /api/v1/auth/password/forgot": "public",
  "POST /api/v1/auth/password/reset": "public",
  "POST /api/v1/settings/smtp/test": "scoped",
  "POST /api/v1/settings/support-requests/email/test": "scoped",
  "POST /api/v1/sessions/:id/email": "tenant",
  "POST /api/v1/users/:id/reset-mfa": "tenant",
  "POST /api/v1/users/:id/forget-devices": "tenant", // P27a (AC-330)
  // P27a (AC-329): profil cihaz listesi/silme yalnız oturum sahibinin satırları (başka kullanıcının id'si 404)
  "GET /api/v1/auth/trusted-devices": "self",
  "DELETE /api/v1/auth/trusted-devices/:id": "self",
  "DELETE /api/v1/auth/trusted-devices": "self",
  "DELETE /api/v1/users/:id": "tenant", // P16 (AC-241): step-up'lı B Admin'i → A kullanıcısı 404
  // P2
  "POST /api/v1/sessions": "self",
  "GET /api/v1/sessions": "list",
  "GET /api/v1/sessions/:id": "tenant",
  "POST /api/v1/sessions/:id/cancel": "tenant",
  "POST /api/v1/public/sessions/resolve": "public",
  "GET /api/v1/public/sessions/status": "public",
  // P3
  "GET /metrics": "public",
  "POST /api/v1/sessions/:id/terminate": "tenant",
  "POST /api/v1/public/sessions/join": "public",
  // P6
  "GET /api/v1/public/agent/download": "public",
  "GET /api/v1/public/agent/availability": "public",
  // P6 düzeltme 1 (S6-2): Caddy forward_auth iç ucu; yalnız güvenilen proxy soketinden, tenant verisi yok
  "GET /internal/agent-ready": "public",
  "GET /internal/agent-ready/windows": "public",
  "GET /internal/agent-ready/macos": "public",
  // P8 oturum geçmişi (historyScope)
  "GET /api/v1/sessions/export.csv": "list",
  "GET /api/v1/sessions/:id/history": "tenant",
  "GET /api/v1/sessions/:id/chat": "tenant", // P22 (AC-264): historyScope + sessions.view_chat
  // P13b-L: kendi bekleyen lobilerim (tenantScope + auth'tan teknisyen); izolasyon sessions-lobby-p13bl.test.ts "AC-309/310"
  "GET /api/v1/sessions/waiting": "scoped",
  "PATCH /api/v1/sessions/:id": "tenant",
  // P8b-1 destek talepleri
  "GET /api/v1/public/requests/tenant": "public",
  "POST /api/v1/public/requests": "public",
  "POST /api/v1/public/requests/cancel": "public",
  // P19 J2 (AC-259): web talep formu — kimliksiz, ref + form token'ı (tek tip 404; tenant id almaz).
  "GET /api/v1/public/web-requests/form": "public",
  "POST /api/v1/public/web-requests": "public",
  "GET /api/v1/public/agent/request-download": "public",
  "GET /api/v1/support-requests": "scoped",
  "GET /api/v1/support-requests/count": "scoped",
  "GET /api/v1/support-requests/:id": "tenant",
  "POST /api/v1/support-requests/:id/accept": "tenant",
  "POST /api/v1/support-requests/:id/reject": "tenant",
  "GET /api/v1/settings/support-requests": "scoped",
  "PUT /api/v1/settings/support-requests": "scoped",
  "POST /api/v1/settings/support-requests/rotate-ref": "scoped",
  "POST /api/v1/settings/support-requests/whatsapp/test": "scoped",
  // P8c-1 müşteriler + cihaz kaydı (koleksiyon uçlarının izolasyonu: customers-p8c-api.test.ts "AC-172")
  "POST /api/v1/support-requests/:id/revoke-binding": "tenant",
  "GET /api/v1/customers": "scoped",
  "GET /api/v1/customers/general-link": "scoped",
  "GET /api/v1/customers/options": "scoped",
  "POST /api/v1/customers": "scoped",
  "GET /api/v1/customers/:id": "tenant",
  "PATCH /api/v1/customers/:id": "tenant",
  "POST /api/v1/customers/:id/rotate-ref": "tenant",
  "POST /api/v1/customers/:id/deactivate": "tenant",
  "POST /api/v1/customers/:id/reactivate": "tenant",
  "GET /api/v1/customers/:id/requests": "tenant",
  "GET /api/v1/customers/:id/sessions": "tenant",
  "POST /api/v1/public/bindings/status": "public",
  "POST /api/v1/public/bindings/revoke": "public",
  // P9 kullanıcı/yetki/firma yönetimi (koleksiyon izolasyonu: users-p9.test.ts "AC-69")
  "GET /api/v1/users": "scoped",
  "POST /api/v1/users": "scoped",
  "GET /api/v1/users/:id": "tenant",
  "PATCH /api/v1/users/:id": "tenant",
  "POST /api/v1/users/:id/deactivate": "tenant",
  "POST /api/v1/users/:id/reactivate": "tenant",
  "GET /api/v1/settings/tenant": "scoped",
  "PUT /api/v1/settings/tenant": "scoped",
  "GET /api/v1/admin/tenants": "system",
  "POST /api/v1/admin/tenants": "system",
  "GET /api/v1/admin/tenants/:id": "system",
  "PATCH /api/v1/admin/tenants/:id": "system",
  "POST /api/v1/admin/tenants/:id/deactivate": "system",
  "POST /api/v1/admin/tenants/:id/reactivate": "system",
  "POST /api/v1/admin/switch-tenant": "system",
  // P11 audit ekranı (kapsam izolasyonu: audit-p11.test.ts "AC-76/AC-69"); 405 uçları kimliksiz, veri dönmez
  "GET /api/v1/audit": "scoped",
  "GET /api/v1/audit/export.csv": "scoped",
  "POST /api/v1/audit": "public",
  "PUT /api/v1/audit": "public",
  "PATCH /api/v1/audit": "public",
  "DELETE /api/v1/audit": "public",
  "POST /api/v1/audit/export.csv": "public",
  "PUT /api/v1/audit/export.csv": "public",
  "PATCH /api/v1/audit/export.csv": "public",
  "DELETE /api/v1/audit/export.csv": "public",
  "POST /api/v1/audit/:id": "public",
  "PUT /api/v1/audit/:id": "public",
  "PATCH /api/v1/audit/:id": "public",
  "DELETE /api/v1/audit/:id": "public",
  // P11 sistem ayarları (SUPER_ADMIN) ve aydınlatma metni (tenantScope)
  "GET /api/v1/admin/settings/mysql": "system",
  "PUT /api/v1/admin/settings/mysql": "system",
  "POST /api/v1/admin/settings/mysql/test": "system",
  "GET /api/v1/admin/settings/turn": "system",
  "PUT /api/v1/admin/settings/turn": "system",
  "DELETE /api/v1/admin/settings/turn": "system",
  "GET /api/v1/admin/settings/whatsapp": "system", // P12b (AC-196)
  "PUT /api/v1/admin/settings/whatsapp": "system",
  "DELETE /api/v1/admin/settings/whatsapp": "system",
  "POST /api/v1/admin/settings/whatsapp/test": "system",
  // P28b (AC-353): ClamAV ayarı (DELETE yok)
  "GET /api/v1/admin/settings/clamav": "system",
  "PUT /api/v1/admin/settings/clamav": "system",
  "POST /api/v1/admin/settings/clamav/test": "system",
  // P28b (§4): bayt uçları çerezsiz, yalnız Bearer belirteç (fid + tenant + oturum bağlı; izolasyon fsrv-p28b-files "D-P28b-2")
  "PUT /api/v1/fsrv/uploads/:fid/chunks/:n": "public",
  "GET /api/v1/fsrv/files/:fid/content": "public",
  "POST /api/v1/sessions/:id/stored-files/:fid/link": "tenant",
  // P28e (§5): parça uçları çerezsiz, yalnız Bearer belirteç (rid + tenant + oturum bağlı; izolasyon rec-p28e-k3 "S-P28e-6");
  // geçmiş kayıt uçları tenant (B'nin A oturumuna isteği → 404); ayar tenantScope'lu (rec-p28e-k3 "AC-380").
  "PUT /api/v1/rec/:rid/series/:s/parts/:p": "public",
  "GET /api/v1/rec/:rid/series/:s/parts/:p": "public",
  "GET /api/v1/sessions/:id/recording": "tenant",
  "POST /api/v1/sessions/:id/recording/view": "tenant",
  "DELETE /api/v1/sessions/:id/recording": "tenant",
  "GET /api/v1/settings/recording": "scoped",
  "PUT /api/v1/settings/recording": "scoped",
  "GET /api/v1/settings/consent-text": "scoped",
  "PUT /api/v1/settings/consent-text": "scoped",
  // P12 marka (izolasyon: branding-api-p12.test.ts "AC-84"); logo dosyaları ve marka ucu kimliksiz (yalnız logo)
  "POST /api/v1/settings/logo": "scoped",
  "DELETE /api/v1/settings/logo": "scoped",
  "POST /api/v1/users/:id/avatar": "tenant",
  "DELETE /api/v1/users/:id/avatar": "tenant",
  "POST /api/v1/admin/settings/system-logo": "system",
  "GET /api/v1/files/logo/:tenantId/:file": "public",
  "GET /api/v1/files/system-logo/:file": "public",
  "GET /api/v1/files/avatar/:tenantId/:file": "tenant",
  "GET /api/v1/public/branding": "public",
  "PATCH /api/v1/auth/me/preferences": "self",
  // P14a (AC-215): step-up yalnız kendi oturumuna yazar
  "POST /api/v1/auth/step-up": "self",
  // P14b (AC-225/226): seçenek uçları (izolasyon: security-p14a-users.test.ts "AC-225")
  "GET /api/v1/users/options": "scoped",
  "GET /api/v1/admin/tenants/options": "system",
  // P15 (AC-231..236): kurtarma kodu kendi hesabı; SA sıfırlama + sistem logosu kaldırma sistem; engeller tenantScope'lu
  // koleksiyon (izolasyon: p15-backend.test.ts "AC-235") + id'li kaldırma; imzalı avatar kimliksiz (imza + oturum durumu).
  "POST /api/v1/auth/mfa/recovery-codes": "self",
  "GET /api/v1/admin/superadmins": "system",
  "POST /api/v1/admin/superadmins/:id/reset-password": "system",
  "DELETE /api/v1/admin/settings/system-logo": "system",
  // P16 G3 (AC-242): firma kalıcı silme (yalnız SUPER_ADMIN)
  "POST /api/v1/admin/tenants/:id/purge": "system",
  "DELETE /api/v1/admin/tenants/:id/purge": "system",
  "GET /api/v1/admin/tenants/:id/purge": "system",
  "GET /api/v1/admin/purge-jobs": "system",
  "GET /api/v1/request-blocks": "scoped",
  "POST /api/v1/request-blocks": "scoped",
  "DELETE /api/v1/request-blocks/:id": "tenant",
  // P18 H2 (AC-256..258)
  "POST /api/v1/support-requests/:id/assign": "tenant",
  "POST /api/v1/support-requests/:id/priority": "tenant",
  // P18 H3 (AC-255)
  "GET /api/v1/support-requests/:id/messages": "tenant",
  "POST /api/v1/support-requests/:id/messages": "tenant",
  "GET /api/v1/settings/business-hours": "scoped",
  "PUT /api/v1/settings/business-hours": "scoped",
  "GET /api/v1/settings/holidays": "scoped",
  "POST /api/v1/settings/holidays": "scoped",
  "POST /api/v1/settings/holidays/import-tr": "scoped",
  "DELETE /api/v1/settings/holidays/:id": "tenant",
  "GET /api/v1/public/sessions/:sessionId/tech-avatar": "public",
  // P19 J4 (AC-263): CSV dışa/içe aktarma — tenantScope'lu koleksiyon (izolasyon: customers-csv-p19.test.ts)
  "GET /api/v1/customers/export.csv": "scoped",
  "POST /api/v1/customers/import/preview": "scoped",
  "POST /api/v1/customers/import/commit": "scoped",
  // P19 J3 (AC-260): bağlantı gönderimi (kendi oturumu; başka tenant → 404) ve firma SMS ayarı (tenantScope)
  "POST /api/v1/sessions/:id/send-link": "tenant",
  "GET /api/v1/sessions/:id/send-link/options": "tenant",
  "GET /api/v1/settings/sms": "scoped",
  "PUT /api/v1/settings/sms": "scoped",
  "POST /api/v1/settings/sms/test": "scoped",
};

export interface TwoTenants {
  a: {
    tenantId: string;
    admin: TestUser;
    user: TestUser;
    sessionId: string;
    requestId: string;
    customerId: string;
    blockId: string;
    holidayId: string;
    /** P27-K3: gözetimsiz cihaz (connect IDOR satırı). */
    deviceId: string;
    /** P27-K2: bekleyen kayıt kodu (DELETE IDOR satırı). */
    codeId: string;
    /** P27a (D-P27a-K4): Admin'in hatırlanan cihazı (`GET /auth/trusted-devices` self kontrolü). */
    trustedDeviceId: string;
  };
  b: {
    tenantId: string;
    admin: TestUser;
    user: TestUser;
    sessionId: string;
    requestId: string;
    customerId: string;
    blockId: string;
    holidayId: string;
    /** P27-K3: gözetimsiz cihaz (connect IDOR satırı). */
    deviceId: string;
    /** P27-K2: bekleyen kayıt kodu (DELETE IDOR satırı). */
    codeId: string;
    /** P27a (D-P27a-K4): Admin'in hatırlanan cihazı (`GET /auth/trusted-devices` self kontrolü). */
    trustedDeviceId: string;
  };
}

export interface CrossTenantCase {
  route: string;
  /** B kullanıcısıyla, A tenant'ının kaydını hedefleyen istek. */
  request: (fx: TwoTenants) => InjectOptions;
  /** P16: uç step-up ister (AC-215) → istek step-up'lı B Admin oturumuyla gönderilir (yoksa 401 404'ü gölgeler). */
  stepUp?: boolean;
}

export const CROSS_TENANT_CASES: CrossTenantCase[] = [
  {
    route: "POST /api/v1/sessions/:id/supervise",
    request: (fx) => ({ method: "POST", url: `/api/v1/sessions/${fx.a.sessionId}/supervise`, payload: {} }),
  },
  {
    route: "GET /api/v1/sessions/:id/invite-candidates",
    request: (fx) => ({ method: "GET", url: `/api/v1/sessions/${fx.a.sessionId}/invite-candidates` }),
  },
  {
    route: "POST /api/v1/sessions/:id/invites",
    request: (fx) => ({ method: "POST", url: `/api/v1/sessions/${fx.a.sessionId}/invites`, payload: { userId: fx.a.sessionId } }),
  },
  { route: "GET /api/v1/sessions/:id/invites", request: (fx) => ({ method: "GET", url: `/api/v1/sessions/${fx.a.sessionId}/invites` }) },
  {
    route: "DELETE /api/v1/sessions/:id/invites/:inviteId",
    request: (fx) => ({ method: "DELETE", url: `/api/v1/sessions/${fx.a.sessionId}/invites/AAAAAAAAAAAAAAAAAAAAAA` }),
  },
  {
    route: "POST /api/v1/sessions/:id/unattended/lock",
    request: (fx) => ({ method: "POST", url: `/api/v1/sessions/${fx.a.sessionId}/unattended/lock`, payload: {} }),
  },
  {
    route: "POST /api/v1/sessions/:id/unattended/logoff",
    request: (fx) => ({ method: "POST", url: `/api/v1/sessions/${fx.a.sessionId}/unattended/logoff`, payload: { confirm: true } }),
  },
  {
    route: "POST /api/v1/unattended/devices/:id/connect",
    request: (fx) => ({ method: "POST", url: `/api/v1/unattended/devices/${fx.a.deviceId}/connect`, payload: {} }),
    stepUp: true,
  },
  // P27-K2 (AC-275, 293, 337): A'nın cihazı / kodu / müşteri adresleri B Admin'ine 404 (yazma uçları step-up'lı oturumla).
  { route: "GET /api/v1/unattended/devices/:id", request: (fx) => ({ method: "GET", url: `/api/v1/unattended/devices/${fx.a.deviceId}` }) },
  {
    route: "PUT /api/v1/unattended/devices/:id/grants",
    request: (fx) => ({ method: "PUT", url: `/api/v1/unattended/devices/${fx.a.deviceId}/grants`, payload: { userIds: [fx.b.user.id] } }),
    stepUp: true,
  },
  {
    route: "POST /api/v1/unattended/devices/:id/revoke",
    request: (fx) => ({ method: "POST", url: `/api/v1/unattended/devices/${fx.a.deviceId}/revoke`, payload: {} }),
  },
  {
    route: "DELETE /api/v1/unattended/registration-codes/:id",
    request: (fx) => ({ method: "DELETE", url: `/api/v1/unattended/registration-codes/${fx.a.codeId}` }),
  },
  {
    route: "GET /api/v1/unattended/customers/:customerId/contacts",
    request: (fx) => ({ method: "GET", url: `/api/v1/unattended/customers/${fx.a.customerId}/contacts` }),
  },
  {
    route: "PUT /api/v1/unattended/customers/:customerId/contacts",
    request: (fx) => ({
      method: "PUT",
      url: `/api/v1/unattended/customers/${fx.a.customerId}/contacts`,
      payload: { items: [{ email: "x@example.test" }] },
    }),
    stepUp: true,
  },
  { route: "GET /api/v1/sessions/:id", request: (fx) => ({ method: "GET", url: `/api/v1/sessions/${fx.a.sessionId}` }) },
  {
    route: "POST /api/v1/sessions/:id/stored-files/:fid/link",
    request: (fx) => ({ method: "POST", url: `/api/v1/sessions/${fx.a.sessionId}/stored-files/${newId()}/link` }),
  },
  // P28e: A oturumunun kaydı B Admin'ine 404 (kayıt olsun olmasın aynı yanıt).
  {
    route: "GET /api/v1/sessions/:id/recording",
    request: (fx) => ({ method: "GET", url: `/api/v1/sessions/${fx.a.sessionId}/recording` }),
  },
  {
    route: "POST /api/v1/sessions/:id/recording/view",
    request: (fx) => ({ method: "POST", url: `/api/v1/sessions/${fx.a.sessionId}/recording/view`, payload: {} }),
  },
  {
    route: "DELETE /api/v1/sessions/:id/recording",
    request: (fx) => ({ method: "DELETE", url: `/api/v1/sessions/${fx.a.sessionId}/recording`, payload: { confirm: true } }),
  },
  { route: "POST /api/v1/sessions/:id/cancel", request: (fx) => ({ method: "POST", url: `/api/v1/sessions/${fx.a.sessionId}/cancel` }) },
  {
    route: "POST /api/v1/sessions/:id/terminate",
    request: (fx) => ({ method: "POST", url: `/api/v1/sessions/${fx.a.sessionId}/terminate` }),
  },
  { route: "GET /api/v1/sessions/:id/history", request: (fx) => ({ method: "GET", url: `/api/v1/sessions/${fx.a.sessionId}/history` }) },
  { route: "GET /api/v1/sessions/:id/chat", request: (fx) => ({ method: "GET", url: `/api/v1/sessions/${fx.a.sessionId}/chat` }) },
  {
    route: "PATCH /api/v1/sessions/:id",
    request: (fx) => ({ method: "PATCH", url: `/api/v1/sessions/${fx.a.sessionId}`, payload: { note: "x" } }),
  },
  { route: "GET /api/v1/support-requests/:id", request: (fx) => ({ method: "GET", url: `/api/v1/support-requests/${fx.a.requestId}` }) },
  {
    route: "POST /api/v1/support-requests/:id/accept",
    request: (fx) => ({ method: "POST", url: `/api/v1/support-requests/${fx.a.requestId}/accept`, payload: {} }),
  },
  {
    route: "POST /api/v1/support-requests/:id/revoke-binding",
    request: (fx) => ({ method: "POST", url: `/api/v1/support-requests/${fx.a.requestId}/revoke-binding`, payload: {} }),
  },
  ...(["GET /api/v1/customers/:id", "GET /api/v1/customers/:id/requests", "GET /api/v1/customers/:id/sessions"] as const).map((route) => ({
    route,
    request: (fx: TwoTenants): InjectOptions => ({ method: "GET", url: route.slice(4).replace(":id", fx.a.customerId) }),
  })),
  {
    route: "PATCH /api/v1/customers/:id",
    request: (fx) => ({ method: "PATCH", url: `/api/v1/customers/${fx.a.customerId}`, payload: { note: "x" } }),
  },
  ...(["rotate-ref", "deactivate", "reactivate"] as const).map((a) => ({
    route: `POST /api/v1/customers/:id/${a}`,
    request: (fx: TwoTenants): InjectOptions => ({ method: "POST", url: `/api/v1/customers/${fx.a.customerId}/${a}`, payload: {} }),
  })),
  // P9: A tenant'ının kullanıcısını B Admin'i hedefler → 404
  { route: "GET /api/v1/users/:id", request: (fx) => ({ method: "GET", url: `/api/v1/users/${fx.a.user.id}` }) },
  {
    route: "PATCH /api/v1/users/:id",
    // P14a (AC-206): geçerli biçimde If-Match (sürüm 0) — 428 değil, kapsam kararı (404) sınanır.
    request: (fx) => ({
      method: "PATCH",
      url: `/api/v1/users/${fx.a.user.id}`,
      headers: { "if-match": '"v0"' },
      payload: { fullName: "Başka Firma" },
    }),
  },
  // P10: başka tenant'ın oturumu / kullanıcısı → 404
  {
    route: "POST /api/v1/sessions/:id/email",
    request: (fx) => ({
      method: "POST",
      url: `/api/v1/sessions/${fx.a.sessionId}/email`,
      payload: { to: "x@example.test", link: "https://x.test/session/y" },
    }),
  },
  // P19 J3: başka tenant'ın oturumuna bağlantı gönderimi / seçenekleri → 404
  {
    route: "POST /api/v1/sessions/:id/send-link",
    request: (fx) => ({
      method: "POST",
      url: `/api/v1/sessions/${fx.a.sessionId}/send-link`,
      payload: { channel: "SMS", phone: "05321234567", link: "https://x.test/session/y" },
    }),
  },
  {
    route: "GET /api/v1/sessions/:id/send-link/options",
    request: (fx) => ({ method: "GET", url: `/api/v1/sessions/${fx.a.sessionId}/send-link/options` }),
  },
  ...(["deactivate", "reactivate", "reset-mfa", "forget-devices"] as const).map((a) => ({
    route: `POST /api/v1/users/:id/${a}`,
    request: (fx: TwoTenants): InjectOptions => ({ method: "POST", url: `/api/v1/users/${fx.a.user.id}/${a}`, payload: {} }),
  })),
  // P12: A kullanıcısının avatarı / A klasöründeki dosya → 404
  {
    route: "POST /api/v1/users/:id/avatar",
    request: (fx) => ({ method: "POST", url: `/api/v1/users/${fx.a.user.id}/avatar`, payload: {} }),
  },
  {
    route: "DELETE /api/v1/users/:id",
    stepUp: true,
    request: (fx) => ({
      method: "DELETE",
      url: `/api/v1/users/${fx.a.user.id}`,
      headers: { "if-match": '"v0"' },
      payload: { confirmName: "Test Kullanıcı" },
    }),
  },
  { route: "DELETE /api/v1/users/:id/avatar", request: (fx) => ({ method: "DELETE", url: `/api/v1/users/${fx.a.user.id}/avatar` }) },
  {
    route: "GET /api/v1/files/avatar/:tenantId/:file",
    request: (fx) => ({ method: "GET", url: `/api/v1/files/avatar/${fx.a.tenantId}/${"A".repeat(24)}.webp` }),
  },
  // P15 (AC-235): A'nın engelini B Admin'i kaldıramaz → 404
  { route: "DELETE /api/v1/request-blocks/:id", request: (fx) => ({ method: "DELETE", url: `/api/v1/request-blocks/${fx.a.blockId}` }) },
  // P18 H2 (AC-256, 257, 258): A'nın talebini B atayamaz / önceliğini değiştiremez, tatilini silemez → 404
  {
    route: "POST /api/v1/support-requests/:id/assign",
    request: (fx) => ({ method: "POST", url: `/api/v1/support-requests/${fx.a.requestId}/assign`, payload: { userId: null } }),
  },
  {
    route: "POST /api/v1/support-requests/:id/priority",
    request: (fx) => ({ method: "POST", url: `/api/v1/support-requests/${fx.a.requestId}/priority`, payload: { priority: "HIGH" } }),
  },
  // P18 H3 (AC-255): A'nın talebinin mesajlarını B okuyamaz / yazamaz → 404
  {
    route: "GET /api/v1/support-requests/:id/messages",
    request: (fx) => ({ method: "GET", url: `/api/v1/support-requests/${fx.a.requestId}/messages` }),
  },
  {
    route: "POST /api/v1/support-requests/:id/messages",
    request: (fx) => ({
      method: "POST",
      url: `/api/v1/support-requests/${fx.a.requestId}/messages`,
      payload: { body: "Merhaba", clientMsgId: "m-1" },
    }),
  },
  {
    route: "DELETE /api/v1/settings/holidays/:id",
    request: (fx) => ({ method: "DELETE", url: `/api/v1/settings/holidays/${fx.a.holidayId}` }),
  },
  {
    route: "POST /api/v1/support-requests/:id/reject",
    request: (fx) => ({
      method: "POST",
      url: `/api/v1/support-requests/${fx.a.requestId}/reject`,
      payload: { message: "Şu an müsait değiliz" },
    }),
  },
];

/** buildApp sonrası, ready'den ÖNCE çağrılmalı (rotalar eklentilerde ready'de yüklenir). */
export function collectRoutes(app: FastifyInstance): string[] {
  const routes: string[] = [];
  app.addHook("onRoute", (r) => {
    for (const m of [r.method].flat()) if (m !== "HEAD") routes.push(`${m} ${r.url}`);
  });
  return routes;
}

export async function twoTenants(): Promise<TwoTenants> {
  const side = async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const user = await createUser({
      tenantId: t.id,
      role: "USER",
      perms: { "sessions.view": true, "session_history.view": true, "session_history.export": true },
    });
    const session = await createSupportSessionRow({ tenantId: t.id, technicianId: user.id });
    const request = await createRequestRow(t.id); // P8b
    const customer = await createCustomerRow(t.id); // P8c
    const blockId = newId(); // P15 (AC-235)
    await testDb().requestBlock.create({
      data: { id: blockId, tenantId: t.id, kind: "DEVICE", deviceKeyHash: sha256Hex(blockId), createdBy: admin.id },
    });
    const holidayId = newId(); // P18 (AC-258)
    await testDb().businessHoliday.create({
      data: { id: holidayId, tenantId: t.id, day: new Date("2026-12-31T00:00:00.000Z"), name: "Yıl sonu", createdBy: admin.id },
    });
    const deviceId = await createDeviceRow({ tenantId: t.id, customerId: customer.id }); // P27-K3
    const codeId = await codeRow(t.id, customer.id); // P27-K2
    const trustedDeviceId = newId(); // P27a (D-P27a-K4)
    await testDb().trustedDevice.create({
      data: {
        id: trustedDeviceId,
        tenantId: t.id,
        userId: admin.id,
        tokenHash: sha256Hex(trustedDeviceId),
        uaSummary: "Chrome · Windows",
        ip: "203.0.113.9",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    return {
      tenantId: t.id,
      admin,
      user,
      sessionId: session.id,
      requestId: request.id,
      customerId: customer.id,
      blockId,
      holidayId,
      deviceId,
      codeId,
      trustedDeviceId,
    };
  };
  return { a: await side(), b: await side() };
}

/** A tarafının yanıtta görünmemesi gereken kimlikleri. */
export const idsOf = (s: TwoTenants["a"]): string[] => [
  s.tenantId,
  s.admin.id,
  s.user.id,
  s.admin.email,
  s.user.email,
  s.sessionId,
  s.trustedDeviceId,
];
