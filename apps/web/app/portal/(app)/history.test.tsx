import type { PortalPage, PortalRequestItem, PortalSessionItem } from "@remote/contracts/api/portal";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ServerResult } from "@/lib/server-api";
import { PortalTabs, RequestsPanel, SessionsPanel } from "./history";

const ok = <T,>(items: T[], total = items.length): ServerResult<PortalPage<T>> => ({
  kind: "ok",
  data: { items, page: 1, pageSize: 25, total },
  at: 0,
});
const fail: ServerResult<never> = { kind: "error", status: 500, code: "INTERNAL" };
const rq = (p: Partial<PortalRequestItem> = {}): PortalRequestItem => ({
  id: "01JD0000000000000000000001",
  requestCode: "481000",
  status: "PENDING",
  source: "WEB",
  priority: "NORMAL",
  requesterName: null,
  createdAt: "2026-11-20T09:01:12.000Z",
  closedAt: null,
  sessionId: null,
  ...p,
});

describe("P21 portal geçmişi bileşenleri (5 durum)", () => {
  it("kısmi: oturumlar hata → sekmede 'yüklenemedi', talepler sayacı görünür; etkin sekme aria-current", () => {
    const html = renderToStaticMarkup(
      <PortalTabs tab="requests" rq={ok([rq()], 30)} ss={fail as ServerResult<PortalPage<PortalSessionItem>>} />,
    );
    expect(html).toContain("Talepler (30)");
    expect(html).toContain("Oturumlar (yüklenemedi)");
    expect(html).toMatch(/aria-current="page"[^>]*data-testid="portal-tab-requests"/);
  });
  it("boş: yönlendirici mesaj + yeni talep eylemi (tam yükleme bağlantısı)", () => {
    const html = renderToStaticMarkup(<RequestsPanel res={ok<PortalRequestItem>([])} />);
    expect(html).toContain("Henüz talep yok");
    expect(html).toContain('href="/portal/new-request"');
  });
  it("başarı: tablo + kart, anonim kişi '—', durum rozeti; açıklama/not alanı yok", () => {
    const html = renderToStaticMarkup(<RequestsPanel res={ok([rq()])} />);
    expect(html).toContain('data-testid="portal-rq-row"');
    expect(html).toContain('data-testid="portal-rq-card"');
    expect(html).toContain("—");
    expect(html).toContain("Bekliyor");
    expect(html).toContain('href="/portal/requests/01JD0000000000000000000001"');
  });
  it("oturumlar boş durumu", () => {
    expect(renderToStaticMarkup(<SessionsPanel res={ok<PortalSessionItem>([])} />)).toContain("Henüz oturum yok");
  });
});
