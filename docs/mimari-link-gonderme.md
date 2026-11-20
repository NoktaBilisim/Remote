# Mimari — Müşteriye bağlantı gönderme (LG)

Tarih: 2026-11-15 · Durum: TASLAK r2 (güvenlik tasarım turu işlendi, §0) · Girdi: `docs/gereksinimler-link-gonderme.md` (AC-405..428, M1..M8) · Sıra: P28'den ÖNCE, tek dikey paket **LG**. Ana belge: `docs/mimari.md`. Kontrol listesi: `docs/tasarim-kontrol.md` "LG".

Açık soru kararları (çağıran ajan): **S-LG1** e-posta ve WhatsApp birlikte sunulur ama her gönderim tek kanala gider (V-LG2). **S-LG2** kılavuz bağlantısı eklenmez.

## 0. r2 notu — güvenlik tasarım turu (`docs/guvenlik-raporu.md` "LG")

| Bulgu  | İşlendiği yer   | Özet                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-LG-1 | §5.4, §12       | `insecureHttp` yerine yeni yüklem: `whatsapp.transportEncrypted = usable && (protocol === "https:" \|\| isLoopbackHost)`. Yüklem `production` bayrağından ve özel ağ istisnasından bağımsızdır.                                                                                                                                                                                                                                                     |
| O-LG-2 | §8, §10.2       | İndirme audit'i "telafi" değil "ipucu"dur. Yazım sınırı: aynı kod + IP için saatte en çok 1, kod başına toplam en çok 10. HEAD isteği audit yazmaz.                                                                                                                                                                                                                                                                                                 |
| O-LG-3 | §1, §4.1, §10.2 | **Koordinatör kararı:** K2 WhatsApp kanalı şimdilik **kapalı**: `CHANNELS_BY_KIND.UNATTENDED_CODE = ["EMAIL"]`. Açılması için iki koşul birlikte gerekir: (a) whatsapp-bildirim servisi ve paneli HTTPS'e geçmiş, panel erişimi kısıtlanmış olmalı; (b) kullanıcı (Nokta) R-LG1 kalan riskini yazılı kabul etmiş olmalı. Bu koşullar sağlandığında `"WHATSAPP"` geri eklenir ve O-LG-1 yüklemi uygulanır.                                           |
| D-LG-1 | §4.2            | `customer-send` eklentisi `onSend` kancasıyla `Cache-Control: no-store` ekler (unattended kalıbı).                                                                                                                                                                                                                                                                                                                                                  |
| D-LG-2 | §4.2, §4.3, §12 | Public uç ayrı ve oturumsuz bir eklentide yer alır (`unattendedRegisterRoutes` kalıbı, `checkPublicClient` benzeri istemci kontrolü). Geçerlilik tek bir yüklemden gelir ve bu yüklem `registerTx` ile paylaşılır: kod kullanılmamış ve süresi dolmamış, müşteri ACTIVE ve anonim değil, **tenant ACTIVE**, gözetimsiz kapısı `available`. Sıra: biçim → IP kovası → yüklem (aksi 404) → ikili kapısı (503). Testlere "tenant pasif → 404" eklenir. |
| D-LG-3 | §3.1, §12       | Belirteç ham 32 bayt HMAC'ten base64url'e çevrilir; hex çıktısı kodlanmaz. Türetme her iki tarafta normalize edilmiş koddan yapılır (tire yok, büyük harf; `registerDevice` ayrıştırıcısı). HKDF amacı `unattended-download` ≠ `unattended-code` olmalıdır; birim testi iki değerin farklı olduğunu doğrular. v1 anahtarı kaldırılırsa bekleyen bağlantılar 404 olur; 24 saatlik ömürle kabul edilir ve runbook'un rotasyon notuna yazılır.         |
| D-LG-4 | §5              | WA kısa metninde `F` ve `T` değişkenlerinden `* _ ~` ve ters tırnak çıkarılır. Tenant adını yalnız Super Admin'in değiştirebildiği doğrulanır; Admin değiştirebiliyorsa bulgu Orta'ya çıkar.                                                                                                                                                                                                                                                        |
| D-LG-5 | §4.5            | Audit'e bakan "iptal → 409" yolu, `unattended.manage` ve `tenant_id + user_id + entity_id` kapsam kontrolünden **sonra** çalışır. Test: manage yetkisi alınmış üretici + iptal kod → 404.                                                                                                                                                                                                                                                           |
| D-LG-6 | §13             | **Prod ön koşulu:** prod açılışında `WHATSAPP_ALLOW_INSECURE_HTTP=false`. Bayrağın bitiş kaydı ("whatsapp-bildirim https olunca kaldırılır") runbook'a ve gereksinimler §9'a Sonra olarak eklenir (devops).                                                                                                                                                                                                                                         |
| KD-LG1 | §3.1            | Güvenlik onayladı.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 1. Özet ve kısıtlar

- Yeni kanal, yeni yetki anahtarı veya yeni hız sınırı altyapısı eklenmez. P10 e-posta (`MailService.sendForTenant`), P19 SMS/WA (`SmsClient`, `WhatsappNotifier.sendCustomer`), `SendLinkLimits` kovaları ve audit rezervasyon kalıbı yeniden kullanılır.
- **Tek yol:** web'de tek bileşen (`SendToCustomerDialog`) ve tek sunucu çifti (`POST /customer-send/options`, `POST /customer-send`) kullanılır. K1'in mevcut uçları (`POST /sessions/:id/email`, `POST /sessions/:id/send-link`, `GET /sessions/:id/send-link/options`) AC-414 gereği sözleşmesi değişmeden kalır. Web bu uçları artık çağırmaz; sunucuda yeni uç aynı servis fonksiyonlarını çağırır. Böylece davranış tek kaynaktan gelir (§4.4).
- Mesaj metnini **yalnız sunucu** üretir. Önizleme ve gönderim aynı fonksiyondan geçer (AC-407). İstemciden yalnız hedef kimliği, kanal ve alıcı gelir. K1'de düz oturum token'ı DB'de olmadığı için bağlantı, K2'de düz kod saklanmadığı için kod istemciden gelir ve sunucuda hash ile doğrulanır.
- Etkileşimli gönderimler outbox'a girmez. Otomatik yeniden deneme yapılmaz.
- `mail/service.ts` ve `notify/service-url.ts` dosyalarının tasarımı bu belgenin kapsamında değildir; başka ajan düzeltiyor. `WHATSAPP_ALLOW_INSECURE_HTTP` bayrağı varsayılır (§5.4).

| Kod | Gönderim                       | Kanallar                             | Yetki                                                                            | Alıcı                                    |
| --- | ------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------- |
| K1  | Oturum bağlantısı + istemci    | E-posta, WhatsApp, SMS               | EMAIL `sessions.create`; SMS/WA `sessions.send_link`; yalnız oturumun teknisyeni | Serbest (talepten doğduysa öneri)        |
| K2  | Kayıt kodu + servis indirme    | E-posta (WhatsApp kapalı, r2 O-LG-3) | `unattended.manage` + kodu üreten kullanıcı                                      | Yalnız `customer_notify_contacts`        |
| K3  | Müşteriye özel indirme + talep | E-posta, WhatsApp                    | `customers.view` + `sessions.send_link`                                          | Serbest, müşteri kaydı/adresleriyle dolu |

## 2. Bileşenler

```mermaid
flowchart LR
  subgraph Web
    A[created-session.tsx] --> D[SendToCustomerDialog]
    B[unattended/code-dialog.tsx] --> D
    C[customers/[id]/customer-actions.tsx] --> D
  end
  D -- "POST /customer-send/options" --> R[customer-send/routes.ts]
  D -- "POST /customer-send" --> R
  R --> T[customer-send/targets.ts<br/>K1/K2/K3 çözücü]
  R --> S[customer-send/service.ts<br/>tavan + rezervasyon + gönderim]
  T --> TP[notify/customer-templates.ts]
  S --> M[MailService]
  S --> W[WhatsappNotifier]
  S --> SM[SmsClient]
  S --> AU[audit]
  P[Müşteri tarayıcısı] -- "GET /public/unattended/download?t=" --> PD[unattended/public-download.ts] --> AB[AgentBinary kapısı]
```

| Bileşen                         | Sorumluluk                                                                                                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customer-send/targets.ts`      | Hedefi (`SESSION` / `UNATTENDED_CODE` / `CUSTOMER`) tenant kapsamında yükler, sahiplik ve durum kurallarını uygular, şablon girdisini (`TemplateInput`) ve kanal izinlerini üretir. Hata sırası §4.3.                                                                 |
| `customer-send/service.ts`      | `options()`: kanal listesi, alıcı listesi, kanal başına önizleme. `send()`: alıcı doğrulama → TX içinde tavanlar ve rezervasyon audit'i → dış gönderim → sonuç audit'i. K1 dalında mevcut `emailSessionLink` / `sendSessionLink` çağrılır.                            |
| `notify/customer-templates.ts`  | Üç gönderim türü için e-posta (`MailContent`) ve kısa metin (WA/SMS) şablonları. `firmName`, `techShortName`, `esc` ve `istanbul` mevcut kaynaklardan gelir. `linkMessage` ve `sessionLinkMail` buraya taşınır; eski ad yeni fonksiyonu dışa aktarır, kopya tutulmaz. |
| `unattended/public-download.ts` | Oturumsuz servis ikilisi indirme ucu (AC-419).                                                                                                                                                                                                                        |
| `SendToCustomerDialog` (web)    | Tek diyalog. Beş durumu, kanal seçimini, alıcıyı ve önizlemeyi yönetir (§9).                                                                                                                                                                                          |

## 3. Veri modeli

**Migration gerekir:** `20261122000000_link_send`. Yeni tablo açılmaz; `unattended_registration_codes` tablosuna iki sütun eklenir.

| Sütun                 | Tip                                   | Kural                                                                                                                                                 |
| --------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `download_token_hash` | `CHAR(64) NULL`, `UNIQUE`             | `SHA-256(token)` hex. `createCode` TX'inde doldurulur. Migration öncesi kodlarda NULL kalır; bu kodlar zaten gönderilemez çünkü düz kod artık yoktur. |
| `sent_count`          | `TINYINT UNSIGNED NOT NULL DEFAULT 0` | K2 kod başına gönderim sayacı. `CHECK (sent_count BETWEEN 0 AND 3)`. Elle SQL ile eklenir (ADR-0014 kalıbı).                                          |

- İndeks: `UNIQUE (download_token_hash)` public uçtaki tek satır aramasını karşılar. MySQL'de UNIQUE birden çok NULL'a izin verir.
- Grant değişmez: `app` bu tabloda zaten SELECT/INSERT/UPDATE/DELETE yetkisine sahip (`grants.sql` satır 143). `grants.sql` yorumuna "LG: sent_count UPDATE" notu düşülür.
- Silme stratejisi değişmez. Kod silindiğinde (iptal, gece temizliği, müşteri pasifi) belirteç hash'i de gider ve bağlantı 404 döner.
- Rollback: `ALTER TABLE … DROP INDEX …, DROP COLUMN sent_count, DROP COLUMN download_token_hash`. Veri kaybı yalnız bekleyen kodların bağlantısıdır; kabul edilir.
- Gönderim geçmişi için ayrı tablo açılmaz. İz audit'te tutulur (LG-S2 Sonra).

### 3.1 İndirme belirteci (V-LG6 kararı: üretimde, türetilmiş)

```
token = base64url( HMAC-SHA256( macKey(v1, "unattended-download"), düzKod ) )   // 32 bayt → 43 karakter
download_token_hash = SHA-256(token) hex
```

- Belirteç kod üretilirken (`createCode`) türetilir ve hash'i yazılır. Düz belirteç hiçbir yerde saklanmaz.
- Gönderimde istemci düz kodu yeniden gönderir (K2 zaten bunu ister, AC-415). Sunucu kodu `code_hash` ile doğrular ve belirteci aynı fonksiyonla yeniden türetir. Böylece iki kanala ve üç gönderime giden bağlantı aynıdır; ilk mesajdaki bağlantı ikinci gönderimde geçersizleşmez.
- `MacPurpose` kümesine `"unattended-download"` eklenir (`lib/crypto.ts`, HKDF ayrı alt anahtar). Anahtar sürümü `code_hash` gibi sabit 1'dir (`CODE_MAC_VERSION`). Rotasyonda bekleyen bağlantılar geçerli kalır.
- **AC-419 yorumu (KD-LG1):** AC "en az 128 bit rastgele" diyor. Türetilen belirteç 256 bitlik bir PRF çıktısıdır. Sunucu anahtarını bilmeyen biri onu rastgeleden ayıramaz ve tahmin edemez. Koddan türetilmesi saklama sorununu çözer: düz değer DB'de tutulmaz, panele de taşınmaz. Değerlendirilen alternatifler: (a) rastgele belirteç üretip üretim yanıtında istemciye vermek; reddedildi, çünkü belirteç panelde dolaşır (V-LG6). (b) Belirteci şifreli saklamak; reddedildi, çünkü AC yalnız hash saklanmasını istiyor. PY'den AC-419 metninde "rastgele" yerine "tahmin edilemez (≥128 bit; rastgele ya da sunucu anahtarlı PRF)" yazılması istenir (§13).

## 4. API sözleşmesi

Yeni contracts dosyası: `packages/contracts/src/api/customer-send.ts`. Hata zarfı, `AppError` kodları ve CSRF mevcut kalıptadır. Tüm uçlar tenant seçimi ister: Super Admin firma seçmediyse 400 `TENANT_REQUIRED` döner (mevcut kural).

### 4.1 zod şemaları

```ts
import { z } from "zod";
import { phoneSchema } from "./requests.ts";
import { sessionTokenSchema } from "./sessions.ts";

export const CUSTOMER_SEND_CHANNELS = ["EMAIL", "WHATSAPP", "SMS"] as const;
export type CustomerSendChannel = (typeof CUSTOMER_SEND_CHANNELS)[number];
/** K2/K3'te SMS yok (kapsam dışı 3). */
export const CHANNELS_BY_KIND = {
  SESSION: ["EMAIL", "WHATSAPP", "SMS"],
  UNATTENDED_CODE: ["EMAIL"], // r2 O-LG-3: WHATSAPP koşullar sağlanınca eklenir (§10.2)
  CUSTOMER: ["EMAIL", "WHATSAPP"],
} as const satisfies Record<string, readonly CustomerSendChannel[]>;

const id26 = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
/** Biçimli (XXXX-XXXX-XXXX-XXXX) ya da düz 16 karakter; sunucu normalize eder (mevcut registerDevice ayrıştırıcısı). */
const regCodeSchema = z.string().min(16).max(19);

export const sendTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("SESSION"), sessionId: id26, link: z.string().min(1).max(500) }),
  z.strictObject({ kind: z.literal("UNATTENDED_CODE"), codeId: id26, code: regCodeSchema }),
  z.strictObject({ kind: z.literal("CUSTOMER"), customerId: id26 }),
]);
export type SendTarget = z.input<typeof sendTargetSchema>;

export const emailRecipientSchema = z.string().trim().max(254).email(); // mevcut contacts e-posta kuralı yeniden kullanılır
export const customerSendOptionsInputSchema = z.strictObject({ target: sendTargetSchema });

/** `to`: EMAIL → e-posta, WHATSAPP/SMS → E.164. Kanal–alıcı uyumu superRefine ile; hata alanı `to`. */
export const customerSendInputSchema = z
  .strictObject({ target: sendTargetSchema, channel: z.enum(CUSTOMER_SEND_CHANNELS), to: z.string().trim().min(1).max(254) })
  .superRefine((v, ctx) => {
    const ok = v.channel === "EMAIL" ? emailRecipientSchema.safeParse(v.to).success : phoneSchema.safeParse(v.to).success;
    if (!ok) ctx.addIssue({ code: "custom", path: ["to"], message: v.channel === "EMAIL" ? "Geçerli bir e-posta adresi girin." : "Telefonu +90… biçiminde girin." });
    if (!(CHANNELS_BY_KIND[v.target.kind] as readonly string[]).includes(v.channel))
      ctx.addIssue({ code: "custom", path: ["channel"], message: "Bu gönderim için kanal desteklenmiyor." });
  });
export type CustomerSendInput = z.input<typeof customerSendInputSchema>;

export const CHANNEL_BLOCKS = ["unconfigured", "insecure_transport", "no_recipient", "sms_tr_only"] as const;
export interface ChannelOption {
  channel: CustomerSendChannel;
  /** Yetkisi olmayan kanal listeye hiç girmez (AC-406, 413). */
  available: boolean;
  block: (typeof CHANNEL_BLOCKS)[number] | null;
  /** Yalnız `settings.view` (WA için Super Admin) varsa: "/settings/smtp" | "/settings/sms" | "/admin/settings/whatsapp". */
  settingsHref: string | null;
}
export interface RecipientChoice {
  /** K2'de seçim yalnız bu listeden yapılır. K1/K3'te öneridir. */
  value: string; // e-posta ya da E.164 (yalnız yetkili panel kullanıcısına; zaten görebildiği veri)
  source: "contact" | "customer" | "request";
}
export interface MessagePreview {
  subject: string | null; // yalnız EMAIL
  text: string; // gönderilecek düz metnin tamamı
}
export interface CustomerSendOptions {
  kind: SendTarget["kind"];
  channels: ChannelOption[];
  recipients: { email: RecipientChoice[]; phone: RecipientChoice[] };
  /** true → alıcı serbest yazılamaz (K2). */
  recipientsLocked: boolean;
  /** Yalnız `available` kanallar için. */
  previews: Partial<Record<CustomerSendChannel, MessagePreview>>;
  /** K2: kalan gönderim hakkı (3 − sent_count). Diğerleri null. */
  remainingSends: number | null;
}
export interface CustomerSendResponse {
  sent: true;
}
export const UNATTENDED_CODE_SENDS_MAX = 3;
```

Mevcut `SendLinkOptions` / `sendLinkInputSchema` ve P10 `sessionEmailInputSchema` olduğu gibi kalır (AC-414).

### 4.2 Uçlar

| Uç                                          | Metot | Girdi                            | Çıktı                                                                                                                                                                                                                                                | Yetki (route preHandler)                                                                                                                               |
| ------------------------------------------- | ----- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/v1/customer-send/options`             | POST  | `customerSendOptionsInputSchema` | `CustomerSendOptions` 200                                                                                                                                                                                                                            | Oturum + CSRF; ayrıntılı yetki hedefe göre serviste (§6). POST kullanılır çünkü gövde gizli değer (bağlantı, kod) taşır; sorgu dizesine konmaz (G-10). |
| `/api/v1/customer-send`                     | POST  | `customerSendInputSchema`        | `CustomerSendResponse` 200                                                                                                                                                                                                                           | Aynı                                                                                                                                                   |
| `/api/v1/public/unattended/download?t=<43>` | GET   | `t`: `^[A-Za-z0-9_-]{43}$`       | 200 akış `application/vnd.microsoft.portable-executable`, `Content-Disposition: attachment; filename="NoktaDestekServis.exe"`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff` | Yok (public)                                                                                                                                           |

Değişen uçlar:

| Uç                                                         | Değişiklik                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /unattended/registration-codes`                      | Sözleşme değişmez. TX içinde `download_token_hash` yazılır.                                       |
| `POST /sessions/:id/email`, `POST /sessions/:id/send-link` | Sözleşme değişmez. Metin yeni K1 şablonundan gelir (§5). `send-link` artık `activeCode` de seçer. |

### 4.3 Hata kodları ve sıra

Sıra her uçta aynıdır: şema 400 → hedef yok veya sahibi değil 404 → yetki 403 → durum 409 → kanal 409 → alıcı 400 → tavan 429 → dış servis 502.

| Durum                                                                                                                              | HTTP / kod                                                                               | Not                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Şema, kanal–alıcı uyumsuz, geçersiz e-posta/telefon                                                                                | 400 `VALIDATION` `fields.to` / `fields.channel`                                          | AC-409. SMS + yurt dışı numara: `fields.to` = `SMS_TR_ONLY_MESSAGE`.                                                                                                       |
| K1 bağlantı oturuma ait değil                                                                                                      | 400 `VALIDATION` `fields.link`                                                           | M1/M2 aynen.                                                                                                                                                               |
| K2 kod HMAC'i `codeId` kaydıyla eşleşmiyor                                                                                         | 400 `VALIDATION` `fields.code`                                                           | AC-415.                                                                                                                                                                    |
| K2 alıcı müşterinin bildirim adreslerinde değil                                                                                    | 400 `VALIDATION` `fields.to`                                                             | AC-417. Dış çağrı yapılmaz.                                                                                                                                                |
| Hedef yok, başka tenant, K1 başka teknisyen, K2 `created_by ≠ user` ya da kullanıcıda `unattended.manage` yok                      | 404 `NOT_FOUND`                                                                          | AC-416: K2'de yetki eksikliği de 404'tür (varlık sızdırılmaz).                                                                                                             |
| K1/K3 kanal yetkisi yok                                                                                                            | 403 `FORBIDDEN`                                                                          | AC-413, 423.                                                                                                                                                               |
| K1 oturum PENDING değil veya süresi dolmuş                                                                                         | 409 `CONFLICT`                                                                           | Mevcut metin.                                                                                                                                                              |
| K2 kod kullanılmış, iptal edilmiş ya da süresi dolmuş                                                                              | 409 `CONFLICT` "Kayıt kodu artık geçerli değil; yeni kod oluşturun."                     | AC-415. İptal edilen kod satırı silindiği için `codeId` bulunamaz; bu durumda HMAC eşleşmesi tenant + `created_by` + `code_hash` ile aranır, bulunamazsa 409 döner (§4.5). |
| K2 gözetimsiz kapısı kapalı                                                                                                        | 409 `UNATTENDED_DISABLED`                                                                | AC-416.                                                                                                                                                                    |
| K2 müşteri pasif veya anonim; K3 müşteri pasif, anonim ya da bağlantısız                                                           | 409 `CONFLICT`                                                                           | AC-421.                                                                                                                                                                    |
| Kanal kullanılamıyor (yapılandırılmamış, güvensiz taşıma, SMTP yok)                                                                | 409 `CHANNEL_UNAVAILABLE`                                                                | AC-408. K1 e-postada bugünkü `UPSTREAM SMTP_REQUIRED_MESSAGE` yanıtı eski uçta korunur. Yeni uç ise kanal listesinde göstermez; doğrudan çağrılırsa 409 döner.             |
| Tavan                                                                                                                              | 429 `RATE_LIMITED` + `Retry-After`                                                       | §7.                                                                                                                                                                        |
| Dış servis hatası                                                                                                                  | 502 `UPSTREAM` + sabit kanal mesajı (`SEND_FAILED_MESSAGES`, `SMTP_SEND_FAILED_MESSAGE`) | Ham sağlayıcı metni dönmez (AC-408).                                                                                                                                       |
| Public indirme: belirteç biçimsiz, bilinmiyor, kod kullanılmış/iptal/süresi dolmuş, müşteri pasif/anonim, gözetimsiz kapısı kapalı | 404 `NOT_FOUND` tek tip gövde                                                            | AC-419. Kapı kapalıyken de 404 döner; ayrı bir durum sızdırılmaz.                                                                                                          |
| Public indirme: ikili kapısı uyuşmuyor                                                                                             | 503 `NOT_READY`                                                                          | M5 kapısı (`AgentBinary.check()`).                                                                                                                                         |
| Public indirme: IP 20/dk aşıldı                                                                                                    | 429                                                                                      | §7.                                                                                                                                                                        |

### 4.4 Sunucu akışı (`POST /customer-send`)

1. Şemayı doğrula. `targets.resolve(target)` hedefi yükler ve §4.3 sırasıyla 404 / 403 / 409 kurallarını uygular. Sonuç `{ kind, entity, entityId, customerId?, templateInput, allowedChannels, recipientsLocked, contactSet? }` olur.
2. Kanal kullanılabilirliğini denetle (§5.4). Kullanılamıyorsa 409.
3. Alıcıyı doğrula. K2'de `to` müşterinin `customer_notify_contacts` kümesinde olmalıdır: e-posta karşılaştırması büyük/küçük harf duyarsızdır, telefon E.164 olarak birebir karşılaştırılır.
4. **K1:** `channel === "EMAIL"` ise `emailSessionLink(...)`, değilse `sendSessionLink(...)` çağrılır. Mevcut tavanlar, audit ve hata eşlemesi aynen işler. Akış burada biter.
5. **K2/K3:** tek TX açılır.
   - `lockTechnician` ile kullanıcı satırı kilitlenir.
   - Kullanıcı tavanı sayılır (§7).
   - K2'de koşullu `UPDATE … SET sent_count = sent_count + 1 WHERE id=? AND tenant_id=? AND created_by=? AND used_at IS NULL AND expires_at > NOW(3) AND sent_count < 3` çalışır. Etkilenen satır 0 ise satır yeniden okunur: `sent_count = 3` → 429, diğer durumlar → 409.
   - Bellek kovaları (alıcı ve tenant) işletilir.
   - `phase:"reserved"` audit satırı yazılır.
6. TX dışında mesaj üretilir. Üretim, önizlemeyle aynı fonksiyonla (`renderFor(kind, channel, templateInput)`) yapılır. Ardından gönderilir:
   - EMAIL → `mail.sendForTenant(ctx, {..., kind: "unattended_code" | "customer_link", entity, entityId}, to, content, cfg, { interactive: true })`
   - WHATSAPP → `whatsapp.sendCustomer(tenantId, recipientHash(secrets, "WHATSAPP", to), to, text)`
7. `phase:"result"` audit satırı yazılır. Hata `send-link.ts` eşlemesiyle döner. Gönderim başarısız olsa da K2 `sent_count` geri alınmaz: deneme hakkı harcanmış sayılır, bu da taciz döngüsünü önler.

`options()` aynı `targets.resolve` adımını çalıştırır. Gönderim, sayaç ve audit yoktur. Önizlemeler aynı `renderFor` ile üretilir.

### 4.5 K2 kod doğrulama ayrıntısı

- `codeHash(secrets, normalize(code))` hesaplanır ve kayıttaki `code_hash` ile `safeEqual` ile karşılaştırılır. Satır şöyle aranır: `id = codeId AND tenant_id AND created_by = user`.
- Satır yoksa (iptal ile silinmiş ya da gece temizliğiyle gitmiş olabilir) ve hash tenant + `created_by` içinde de yoksa, `codeId` hiç görülmemişse 404 döner. İptal edilen kodun audit'i (`unattended.code.cancelled`, `entityId = codeId`, `user`) varsa 409 döner. Böylece "tüketilmiş/iptal → 409" testi tutarlı kalır ve başka kullanıcının kodu sızmaz.
- Kullanılmış ya da süresi dolmuş satır mevcutsa 409 döner.
- r2 (D-LG-5): audit'e bakan iptal yolu, `unattended.manage` ve `tenant_id + user_id + entity_id` kapsam kontrolünden sonra çalışır; yetkisi alınmış üretici 404 görür.

## 5. Mesaj şablonları (`notify/customer-templates.ts`)

Ortak kurallar:

- `F = firmName(tenant.name)`, `T = techShortName(user.fullName)`. Her ikisi `sanitizeTemplateName` süzgecinden geçer (AC-424).
- E-posta HTML gövdesindeki her değişken `esc()` ile kaçışlanır. Konu `oneLine()` ile tek satıra indirilir.
- Saat `istanbul()` ile `dd.MM.yyyy HH:mm` biçiminde yazılır (Europe/Istanbul).
- Bağlantılar her zaman `PUBLIC_BASE_URL` kökeninden üretilir. İstemciden gelen tek bağlantı K1 `link`'idir ve token hash'i ile doğrulanır.
- Müşteri adı, kişi adı, talep metni ve serbest metin şablona girmez.
- `renderFor(kind, channel, input): MessagePreview` tek giriş noktasıdır. Önizleme ve gönderim yalnız bunu çağırır (AC-407).
- `TemplateInput` içinde ikili kapısının sonucu bulunur: `agentOk = (await AgentBinary.check()) === "ok"`. Kapı kapalıysa indirme satırı ve SHA metne hiç girmez (AC-412).

### 5.1 K1 — oturum + istemci

`dl = ${PUBLIC_BASE_URL}/api/v1/public/agent/download?ref=${sessionRef(env.SESSION_REF_KEY, sessionId)}`. Yeni ikili yolu açılmaz (AC-411). `code` 8 hane `1234 5678` biçiminde yazılır.

Kısa metin (WhatsApp ve SMS ortak):

```
{F} uzak destek: {T} sizinle oturum başlatmak istiyor.
Bağlantı: {link}
Windows programı: {dl}            ← yalnız agentOk
Kod: {code} · Son geçerlilik: {until} (TR)
Beklemiyorsanız bağlantıyı açmayın, kimseyle paylaşmayın.
```

E-posta: konu `{F} – uzak destek bağlantınız` (bugünkü konu korunur). Gövde bugünkü `sessionLinkMail` gövdesi ve agentOk ise ek bir blok:

```
Windows 10 / 11 için destek programı: {dl}
Dosya adı "Destek-" ile başlar. SHA-256: {AGENT_SHA256}
```

SMS uzunluğu 2–3 parçaya çıkar (maliyet). Kabul edilir: SMS yalnız K1'de bulunur ve tenant tavanı 200/sa'dir.

> Sapma (qa LG tur 1 madde 7, koordinatör kararı 2026-11-15): SMS'te istemci satırı ve uyarı satırı yoktur; SMS metni `{F} uzak destek ({T}):` / `{link}` / `Kod: {code} · Son geçerlilik: {until} (TR)` → UCS-2 ≤ 3 parça. Kısa metin bloğu yalnız WhatsApp için geçerlidir.

### 5.2 K2 — kayıt kodu + servis kurulumu

`dl = ${PUBLIC_BASE_URL}/api/v1/public/unattended/download?t=${token}` (§3.1). `code = formatRegistrationCode(...)` biçimi `XXXX-XXXX-XXXX-XXXX`'tir. `until = expires_at`. K2'de teknisyen adı yer almaz; kayıt firmayla ilgilidir.

E-posta, konu `{F} – uzaktan destek servisi kurulumu`:

```
Merhaba,

{F}, bilgisayarınıza uzaktan destek servisinin kurulması için bir kayıt kodu oluşturdu.

1. Kurulum dosyasını indirin: {dl}
   Dosya: NoktaDestekServis.exe (Windows 10 / 11) · SHA-256: {UNATTENDED_AGENT_SHA256}
2. Dosyayı çalıştırın ve yönetici izni isteğini onaylayın.
3. Kayıt kodu istendiğinde şunu girin: {code}
4. Kurulum tamamlanınca {F} ile iletişime geçin.

Kod ve bağlantı {until} (Türkiye saati) tarihine kadar geçerlidir; kod bir kez kullanılabilir.

Bu kurulumu siz istemediyseniz destek firmanızı arayın.
```

WhatsApp:

```
{F} uzaktan destek servisi kurulumu.
1) İndirin: {dl}
2) Çalıştırıp yönetici iznini onaylayın.
3) Kayıt kodu: {code}
Son geçerlilik: {until} (TR), tek kullanımlık.
Bu kurulumu siz istemediyseniz destek firmanızı arayın.
```

K2'de ikili kapısı kapalıysa (`check() ≠ ok`) kanal listesi `available:false` ve `block:"unconfigured"` döner. Gönderim 409 olur. İndirme satırı olmayan bir kurulum mesajı anlamsız olduğu için K1'den farklı davranılır.

### 5.3 K3 — müşteriye özel bağlantılar

`downloadUrl` ve `webFormUrl`, `customers/view.ts` içindeki mevcut `requestDownloadUrl` ve `webFormUrl` fonksiyonlarıyla müşterinin **güncel** `request_ref` değerinden üretilir (AC-422). İkisi de null ise 409 döner (AC-421).

Kısa metin (WhatsApp):

```
{F} destek bağlantılarınız:
Hızlı Destek programı (Windows / macOS): {downloadUrl}   ← varsa (P31: aynı bağlantı Mac'te .zip indirir)
Destek talebi formu: {webFormUrl}                     ← varsa
Bu bağlantılar firmanıza özeldir, paylaşmayın.
Bağlantı her zaman {origin}/ ile başlar; dosya eki göndermeyiz.   ← P31 (mimari-p31 §15.3)
```

E-posta konusu `{F} – destek bağlantılarınız`. Gövde aynı satırlardan oluşur; bağlantılar `<a>` içinde verilir. Teknisyen adı yer almaz.

### 5.4 Kanal kullanılabilirliği

| Kanal    | Koşul (hepsi)                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EMAIL    | Kullanıcının o hedefteki e-posta yetkisi var (§6) ve `mail.configFor(tenantId)` dolu.                                                                               |
| WHATSAPP | Yetki var ve `whatsapp.usable`. **K2'de ek koşul:** taşıma güvenli olmalı. **r2 (O-LG-1):** `WhatsappNotifier.transportEncrypted = usable && (protocol === "https:" |     | isLoopbackHost)`(production bayrağından ve özel ağ istisnasından bağımsız; mevcut`insecure`/`insecureAllowed`kullanılmaz).`false`ise`block:"insecure_transport"`+ 409. Şu an K2 WA`CHANNELS_BY_KIND` dışında olduğu için yüklem kanal geri eklendiğinde devreye girer (O-LG-3). |
| SMS      | Yalnız K1. `sessions.send_link` ve `sms.usableFor(tenantId)` gerekir.                                                                                               |

Hiç kanal yoksa diyalog "Gönderim kanalı yapılandırılmamış" der. `settingsHref` yalnız kullanıcı o sayfayı açabiliyorsa dolar: SMTP ve SMS için `settings.view`, WhatsApp sistem ayarı için Super Admin.

## 6. Yetki

Yeni anahtar açılmaz (V-LG3). `sessions.send_link` etiketi ve açıklaması "Müşteriye bağlantı gönder" olarak güncellenir (`permissions.ts`; `pt-surface` snapshot'ı güncellenir).

| Hedef | Kanal    | Arka uç kuralı                                                      | Arayüz                                                                                      |
| ----- | -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| K1    | EMAIL    | `sessions.create` ve `technician_id = user`                         | Kanal listede yalnız yetki varsa yer alır. Düğme, en az bir K1 kanal yetkisi varsa görünür. |
| K1    | WA/SMS   | `sessions.send_link` ve `technician_id = user`                      | Aynı                                                                                        |
| K2    | EMAIL/WA | `unattended.manage` (istek anında) ve `created_by = user`, aksi 404 | Düğme yalnız `code-dialog` içindedir. Diyalog `manage` olmadan zaten açılamaz.              |
| K3    | EMAIL/WA | `customers.view` ve `sessions.send_link`, aksi 403                  | Müşteri ayrıntısında her iki yetki varsa ve AC-421 koşulları sağlanıyorsa görünür.          |

Tenant ayrımı her sorguda `tenant_id = auth.tenantId` ile uygulanır. Super Admin yalnız seçili tenant'ta işlem yapar.

## 7. Hız sınırı

| Kova                       | Değer                | Uygulandığı yer                    | Mekanizma                                                                                                                                                                                                                   |
| -------------------------- | -------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1 e-posta, kullanıcı      | 20/sa                | K1 EMAIL                           | Mevcut `session.email` sayımı, değişmez.                                                                                                                                                                                    |
| Bağlantı havuzu, kullanıcı | 20/sa                | K1 WA/SMS, K2 ve K3 (tüm kanallar) | Mevcut sorgu genişletilir: `action IN ('session.link_sent','unattended.code.sent','customer.link_sent') AND phase='reserved'`. İndeks `(tenant_id, action, created_at)` kullanılır. "Aynı sayaç" (AC-420, 423) bu demektir. |
| Alıcı                      | 5/sa, firma kapsamlı | K1 WA/SMS, K2, K3                  | Mevcut `SendLinkLimits.recipient`. Anahtar `${tenantId}                                                                                                                                                                     | recipientHash(channel, to)`. E-posta için `recipientHash(secrets, "EMAIL", lower(to))`. |
| Tenant                     | 200/sa               | K1 WA/SMS, K2, K3                  | Mevcut `SendLinkLimits.tenant`.                                                                                                                                                                                             |
| K2 kod başına              | 3 (tüm kanallar)     | K2                                 | `sent_count` koşullu UPDATE (§4.4). DB tabanlı olduğu için yeniden başlatmaya dayanıklıdır. 4. istek 429 döner.                                                                                                             |
| Public indirme, IP         | 20/dk                | `GET /public/unattended/download`  | Yeni `FixedWindowCounter(21, 60_000, 60_000)`, anahtar `ipKey(ip)` (IPv6 /64). Belirteç 256 bit olduğu için başarısız arama kovası gerekmez.                                                                                |
| `options`                  | —                    | —                                  | Gönderim yapmaz. Genel oturumlu API sınırları yeterlidir.                                                                                                                                                                   |

`SendLinkLimits` örneği `sessions/routes.ts` içinde oluşuyor. Bu örnek tek bir yerde (`app-hooks` kaydı) oluşturulup hem `sessions/routes.ts` hem `customer-send/routes.ts` tarafından kullanılır. Bellek kovası tek instance varsayımına (ADR-0005) dayanır.

## 8. Audit

Sabitler `packages/contracts/src/audit.ts` dosyasına eklenir. Etiketler `labels.ts` ve audit ekranı süzgeci üzerinden gelir.

| Eylem                                             | Entity / entityId                        | `new_value`                                                                                                             | Not                                                                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.email`, `session.link_sent`, `mail.sent` | Mevcut                                   | Mevcut                                                                                                                  | K1 aynen (AC-414).                                                                                                                                                                    |
| `unattended.code.sent`                            | `unattended_registration_codes` / codeId | reserved: `{phase, channel, recipient, customerId}`; result: `{phase, channel, recipient, customerId, result, reason?}` | AC-420                                                                                                                                                                                |
| `customer.link_sent`                              | `customers` / customerId                 | `{phase, channel, recipient, result?, reason?, links: ["download","webform"]}`                                          | AC-423. `links` yalnız hangi bağlantıların gittiğini söyler; URL ve ref yazılmaz.                                                                                                     |
| `unattended.code.downloaded`                      | `unattended_registration_codes` / codeId | `{customerId}`, `user_id = NULL`, IP ve UA audit bağlamından                                                            | Yalnız başarılı GET indirmesinde yazılır (**ipucu**, telafi değil). r2 O-LG-2 sınırı: aynı kod + IP saatte en çok 1, kod başına en çok 10; HEAD yazmaz. Başarısızlar yalnız metrikte. |

- `recipient` alanı `maskEmail` ya da `maskPhone` ile maskelenir. Kod, belirteç, oturum token'ı, bağlantı ve ref audit'e yazılmaz. `mail.sent` satırına konu yazılır; konu gizli değer içermez.
- Metrikler: `rs_link_send_total{kind,channel,result}` (mevcut metriğe `kind` etiketi eklenir) ve `rs_unattended_download_total{result: ok|not_found|not_ready|rate_limited}`. Etikette alıcı veya kimlik bulunmaz (AC-425).
- Log: `maskUrl` sorgu dizesini zaten kırpıyor, Caddy de sorgu yazmıyor (G-10). Servis kodu `to`, `code`, `link` ve `t` değerlerini loga yazmaz. Pino `REDACT_PATHS` listesine `body.to`, `body.target.code` ve `body.target.link` eklenir (savunma derinliği).

## 9. Web diyaloğu — tek bileşen, üç giriş noktası

Bileşen: `apps/web/components/send-to-customer/send-to-customer-dialog.tsx`. Mantık `use-send-to-customer.ts` dosyasındadır, istemci çağrıları `apps/web/lib/customer-send.ts` içindedir.

```ts
type Props = { target: SendTarget; trigger?: "button" | "inline"; testId?: string };
```

| Giriş noktası            | Dosya                                             | Hedef                                                                | Değişiklik                                                                                                                    |
| ------------------------ | ------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Oluşturulan oturum kartı | `app/(panel)/sessions/created-session.tsx`        | `{kind:"SESSION", sessionId, link}` (bağlantı kartta zaten bellekte) | `session-email.tsx` ve `session-send-link.tsx` **silinir**; yerlerine tek "Müşteriye gönder" (`Send`) düğmesi gelir (AC-405). |
| Kayıt kodu gösterimi     | `app/(panel)/unattended/code-dialog.tsx`          | `{kind:"UNATTENDED_CODE", codeId, code}`                             | Kod gösterim adımına düğme eklenir. Kod dialog kapanınca bellekten atılır, gönderim yolu da kalmaz (AC-415).                  |
| Müşteri ayrıntısı        | `app/(panel)/customers/[id]/customer-actions.tsx` | `{kind:"CUSTOMER", customerId}`                                      | Görünürlük: ACTIVE, anonim değil, (`downloadUrl` ya da `webFormUrl`) var ve iki yetki var (AC-421).                           |

Davranış:

- Açılışta `POST /customer-send/options` çağrılır. Diyalog `channels` listesinden radyo grubu çizer: `Mail`, `MessageCircle` (WhatsApp), `MessageSquareText` (SMS). Klavyeyle ok tuşları kullanılır (AC-426). İlk `available` kanal seçili gelir.
- Alıcı alanı:
  - K2 (`recipientsLocked`): yalnız seçim kutusu.
  - K1/K3: öneri listesi olan metin alanı. İlk öneri ile dolu gelir.
  - WhatsApp/SMS: `checkLinkPhone` ile E.164 önizlemesi gösterilir. E-posta: istemcide `emailRecipientSchema` doğrulaması yapılır. Hata alanın altında görünür (AC-409).
- Önizleme: seçili kanalın `previews[channel]` değeri salt okunur `<pre>` içinde gösterilir; e-postada konu ayrı satırdadır. Metin istemcide yeniden üretilmez (AC-407).
- Durumlar (AC-408):
  - Yükleniyor: skeleton.
  - Kanal yok: bilgi ve varsa ayar bağlantısı.
  - Hata: `LoadError` ve yeniden dene.
  - Başarı: Sonner toast ve satır içi "Gönderildi (kanal, maskeli alıcı)" iletisi. Diyalog açık kalır. K2'de `remainingSends` istemcide bir azaltılır; 0 olunca gönder düğmesi pasif olur.
  - 429: mevcut `SessionSendLink` geri sayım kancası taşınarak yeniden kullanılır.
  - 409: "Kanal kullanılamıyor"; 502: tek genel metin.
- Görünüm ve erişilebilirlik: mevcut dialog primitive'i (odak tuzağı, Esc ile kapanma) kullanılır. Renk ve boşluklar DESIGN.md token'larından gelir. Açık ve koyu temada, 360 px genişlikte yatay kaydırma olmamalı: önizleme `white-space: pre-wrap; overflow-wrap: anywhere` kullanır (AC-426).
- Metinler `messages/tr.json` içinde `customerSend.*` anahtarlarıyla tutulur. Eski `sessions.email*` ve `sessions.sendLink*` anahtarları kullanılmıyorsa silinir.

## 10. Güvenlik

### 10.1 Tehdit özeti

| #     | Tehdit                                                                 | Kontrol                                                                                                                                                                                                      |
| ----- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T-LG1 | Oltalama aracı: panel kullanıcısı keyfi bağlantı ya da metin gönderir. | Metni sunucu üretir. Serbest metin yoktur. Bağlantılar sunucu kökeninden üretilir; K1 bağlantısı token hash'iyle doğrulanır. Ad süzgeci uygulanır (AC-424).                                                  |
| T-LG2 | Taciz veya maliyet: aynı numaraya ya da adrese yoğun gönderim.         | Kullanıcı 20/sa, alıcı 5/sa, tenant 200/sa, K2 kod başına 3 (§7).                                                                                                                                            |
| T-LG3 | Servis indirme bağlantısının tahmini veya taranması.                   | 256 bit PRF belirteci, yalnız hash saklanır, tek tip 404, IP 20/dk. Belirteç koda bağlıdır ve kodla birlikte geçersizleşir.                                                                                  |
| T-LG4 | Bağlantının Referer, log, önbellek veya arama motoru yoluyla sızması.  | Belirteç sorgu dizesindedir; `maskUrl` ve Caddy sorgu dizesini yazmaz (G-10). `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`. Yanıt dosya akışıdır, HTML sayfası yoktur. |
| T-LG5 | Başka tenant'ın veya kullanıcının kodu/oturumu üzerinden gönderim.     | Tenant ve sahiplik filtresi, K2 `created_by`; bulunamazsa 404.                                                                                                                                               |
| T-LG6 | Kişisel verinin log veya metriğe sızması.                              | §8 log ve metrik kuralları; AC-425 log yakalama testi.                                                                                                                                                       |
| T-LG7 | İmzasız ikilinin oturumsuz dağıtımı (R-LG3).                           | `AgentBinary` SHA kapısı (503). E-postada SHA-256 yazılır. Prod'da gözetimsiz kapısı kapalı olduğu için kod da bağlantı da üretilmez (P27).                                                                  |

### 10.2 R-LG1 kararı (r2): K2 WhatsApp kapalı, koşullar sağlanınca açılır

**r2 kararı (koordinatör, O-LG-3):** K2 şimdilik yalnız e-postayla gider. WhatsApp iki koşul birlikte sağlanınca açılır: (a) whatsapp-bildirim servisi ve paneli HTTPS'te ve panel erişimi kısıtlı; (b) kullanıcı R-LG1 kalan riskini yazılı kabul etti. Açıldığında aşağıdaki kontroller geçerlidir.

1. **Şifresiz taşımada kapalı** (`transportEncrypted`, §5.4). `whatsapp-bildirim` servisine giden istek düz http ise, kod ağda açık metin olarak gider. Bu durumda K2 WhatsApp kanalı `available:false` ve `block:"insecure_transport"` döner; sunucu da 409 `CHANNEL_UNAVAILABLE` verir. K1 ve K3 bu bayrakla çalışmaya devam eder: K1 oturum kodu teknisyen onayı olmadan erişim vermez ve süresi kısadır, K3 bağlantıları zaten kalıcı ve yenilenebilir referanslardır. Kayıt kodu ise kalıcı cihaz kaydı verir, bu yüzden eşik daha yüksektir.
2. **İndirme ipucu.** Başarılı servis indirmesi `unattended.code.downloaded` olarak audit'e yazılır (IP ve UA ile; aynı kod + IP saatte en çok 1, kod başına en çok 10, HEAD yazmaz). Bu bir ipucudur, telafi kontrolü değildir: indirmeyi kimin yaptığını kanıtlamaz. Asıl telafi "Yeni — doğrulanmadı" durumu ve P27 kayıt bildirimidir.

Gereksinimden gelen koşullar aynen uygulanır:

- Alıcı yalnız müşterinin kayıtlı bildirim adresi olabilir (AC-417).
- Kod 24 saat geçerli ve tek kullanımlıktır.
- Kod başına en fazla 3 gönderim yapılabilir.
- Cihaz, kayıt olduğunda "Yeni — doğrulanmadı" görünür ve yetki verilene kadar bağlanılamaz.
- Kayıt bildirimi müşteri adreslerine ve `manage` sahiplerine gider (P27).

**Kalan risk (kabul):** `whatsapp-bildirim` hesabına erişimi olan kişi kodu 24 saat boyunca sohbet geçmişinde görebilir. Bu, Nokta'nın kendi işlettiği sistem genel hesabıdır (V-LG5). Bu risk yazılı kabul edilmeden kanal açılmaz. Açılış tek değişikliktir: `CHANNELS_BY_KIND.UNATTENDED_CODE` değerine `"WHATSAPP"` eklenir (genişleme noktası). O sırada şablon, test ve `transportEncrypted` yüklemi hazırdır.

Değerlendirilen alternatifler:

- Kodu ve bağlantıyı ayrı kanallardan göndermek: sadelik ilkesine aykırı (R-LG2).
- WhatsApp'ta yalnız bağlantıyı göndermek, kodu e-postayla göndermek: iki mesaj ve iki kanal gerektirir, tek yol ilkesini bozar.

### 10.3 Başlıklar ve CSP

Public indirme ucu dosya döndürür ve mevcut `/unattended/download` başlıklarını kullanır, ek olarak §4.2'deki başlıkları ekler. Diyalog yeni bir dış kaynak yüklemediği için CSP değişmez.

## 11. Dosya planı

| Dosya                                                                                                                                                                            | İş             | Paket             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------- |
| `apps/server/prisma/migrations/20261122000000_link_send/migration.sql`, `schema.prisma` (`downloadTokenHash`, `sentCount`), `prisma/sql/grants.sql` (yorum)                      | Yeni           | LG-1 dba          |
| `packages/contracts/src/api/customer-send.ts` (+ `package.json` exports), `audit.ts`, `labels.ts`, `permissions.ts` (etiket)                                                     | Yeni / değişir | LG-2 backend      |
| `apps/server/src/customer-send/{routes,service,targets}.ts`                                                                                                                      | Yeni           | LG-2              |
| `apps/server/src/notify/customer-templates.ts`; `notify/templates.ts` ve `mail/templates.ts` (K1 fonksiyonları taşınır)                                                          | Yeni / değişir | LG-2              |
| `apps/server/src/unattended/public-download.ts`, `registration.ts` (token hash yazımı + `downloadToken()`), `lib/crypto.ts` (`MacPurpose`)                                       | Yeni / değişir | LG-2              |
| `apps/server/src/sessions/send-link.ts` (activeCode + yeni şablon + genişletilmiş kullanıcı sayımı), `sessions/email.ts` (yeni şablon), `sessions/routes.ts` (paylaşılan limits) | Değişir        | LG-2              |
| `apps/server/src/lib/logger.ts` (`REDACT_PATHS`)                                                                                                                                 | Değişir        | LG-2              |
| `apps/web/components/send-to-customer/*`, `lib/customer-send.ts`, `messages/tr.json`                                                                                             | Yeni           | LG-3 frontend     |
| `sessions/created-session.tsx`, `unattended/code-dialog.tsx`, `customers/[id]/customer-actions.tsx`; `session-email.tsx`, `session-send-link.tsx` silinir                        | Değişir        | LG-3              |
| `apps/web/e2e/lg-send.spec.ts`, mock SMTP ve mock WA yakalayıcıları (mevcut `mock-*.mjs`), P10/P19 e2e taşınır                                                                   | Yeni / değişir | LG-3              |
| `docs/KULLANIM_KILAVUZU.md` "Müşteriye gönder", `docs/api.md`, `CHANGELOG.md`                                                                                                    | Değişir        | LG-5 teknik-yazar |

Env değişkeni eklenmez. Mevcut `PUBLIC_BASE_URL`, `AGENT_SHA256`, `UNATTENDED_AGENT_PATH` ve `UNATTENDED_AGENT_SHA256` kullanılır. Caddy değişmez: `/api/*` zaten proxy'lenir.

## 12. Test stratejisi

| Seviye                     | Kapsam                                                                                                                                                                                                                                             | AC                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Birim (Vitest, server)     | `renderFor` üç tür × kanal: zorunlu alanların varlığı, yasak alanların (müşteri adı, serbest metin) yokluğu; `agentOk=false` iken çıktıda `download` geçmemesi; `evil.com` ve `<b>x</b>` süzgeci; e-postada SHA var, kısa metinde yok.             | 407, 410, 412, 418, 422, 424 |
| Birim                      | Kanal kombinasyonu matrisi: SMTP var/yok, WA usable/insecure, SMS usable, yetki varyantları → `channels` beklentisi; K2 WA `insecure_transport`.                                                                                                   | 406                          |
| Birim                      | Belirteç türetme: aynı kod → aynı token; farklı kod → farklı token; hash 64 hex; biçim 43 karakter.                                                                                                                                                | 419                          |
| Entegrasyon (gerçek MySQL) | K1: yeni uç ↔ eski uç aynı audit ve tavan; gönderilen metin = `options.previews`; süresi dolmuş oturumda bağlantı 410. **Mevcut P10/P19 testleri değiştirilmeden geçer** (yalnız metin beklentisi).                                                | 407, 411, 413, 414           |
| Entegrasyon                | K2: başka kodun düz metni 400; tüketilmiş 409; iptal edilmiş 409; başka kullanıcı veya yetkisiz 404; kapı kapalı 409; listede olmayan alıcı 400 ve mock'a çağrı yok; 4. gönderim 429; audit `new_value` içinde kodun 16 karakteri ve belirteç yok. | 415–418, 420                 |
| Entegrasyon                | Public indirme: kullanılmış, iptal, süresi dolmuş ve müşteri pasif → aynı 404 gövdesi; geçerli → 200; SHA uyuşmazlığı → 503; 21. istek/dk → 429; başarılı indirmede `unattended.code.downloaded` audit'i.                                          | 419                          |
| Entegrasyon                | K3: ref yenilendikten sonra mesajda yeni ref; pasif müşteri ve bağlantısız müşteri 409; yetki eksik 403; audit'te URL ve ref yok.                                                                                                                  | 421–423                      |
| Entegrasyon                | Log yakalama: üç akışta pino çıktısında telefon, e-posta, kod, token ve belirteç aranır ve bulunmaz.                                                                                                                                               | 425                          |
| Birim (web)                | `use-send-to-customer`: durum makinesi, 429 geri sayımı, K2 `remainingSends`.                                                                                                                                                                      | 408                          |
| E2e (Playwright)           | K1, K2 ve K3, mock SMTP ve mock WA ile: mock'a ulaşan metin = önizleme; oturum kartında gönderim düğmesi sayısı tam 1; axe (ciddi/kritik 0); koyu tema; 360 px yatay kaydırma yok; Esc ile kapanma; klavyeyle kanal değişimi.                      | 405, 408, 409, 426, 427      |
| Doküman                    | qa-denetci kılavuz ve api.md kontrolü.                                                                                                                                                                                                             | 428                          |

Komutlar: `pnpm -r run lint`, `pnpm -r run typecheck`, `pnpm -r run test`, `pnpm --filter @remote/web e2e`.

## 13. Görev paketleri

| Paket                                                                                                                                                     | Ajan         | Bağımlı olduğu                                                                   | Paralel mi                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------- | -------------------------------------- |
| LG-1 Migration (2 sütun, CHECK, UNIQUE), schema, grants yorumu, `docs/db-notlari.md`                                                                      | dba          | —                                                                                | —                                      |
| LG-2 contracts (`customer-send.ts`, audit, etiket), servis/uçlar, şablonlar, public indirme, crypto purpose, logger redact, birim ve entegrasyon testleri | backend-dev  | LG-1                                                                             | LG-3 ile paralel (sözleşme §4.1 sabit) |
| LG-3 Diyalog bileşeni, üç giriş noktası, eski iki bileşenin silinmesi, tr.json, e2e (mock'larla)                                                          | frontend-dev | LG-1 (contracts tiplerini LG-2'nin ilk commit'inden alır; §4.1 burada bağlayıcı) | LG-2 ile paralel                       |
| LG-4a AC denetimi                                                                                                                                         | qa-denetci   | LG-2, LG-3                                                                       | LG-4b ile paralel                      |
| LG-4b AppSec denetimi (R-LG1 kararı, §10 ve belirteç dahil)                                                                                               | guvenlik     | LG-2, LG-3                                                                       | LG-4a ile paralel                      |
| LG-5 Kılavuz, api.md, CHANGELOG                                                                                                                           | teknik-yazar | LG-4 GEÇTİ                                                                       | —                                      |

Devops işi yoktur: env, compose ve Caddy değişmez. **Prod ön koşulu (r2 D-LG-6):** prod açılışında `WHATSAPP_ALLOW_INSECURE_HTTP=false`; bayrak bitiş kaydı runbook'a eklenir. Staging dağıtımı mevcut runbook'la yapılır. K2 staging'de denenir; staging'de WhatsApp http bayrağıyla açıksa K2 WhatsApp yalnız e2e mock'ta doğrulanır (§10.2).

## 14. Kabul kriterleri eşlemesi

| AC  | Bileşen / uç                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------- |
| 405 | `SendToCustomerDialog`, `created-session.tsx` (eski iki bileşen silinir), `code-dialog.tsx`, `customer-actions.tsx` |
| 406 | `service.options()` kanal matrisi §5.4, `settingsHref`                                                              |
| 407 | `renderFor` tek kaynak, `options.previews`, `POST /customer-send`                                                   |
| 408 | Diyalog durumları §9, hata eşlemesi §4.3                                                                            |
| 409 | `customerSendInputSchema` superRefine, istemci doğrulaması                                                          |
| 410 | §5.1 K1 kısa metin ve e-posta                                                                                       |
| 411 | `public/agent/download?ref=` + `sessionRef`; sunucu üretir                                                          |
| 412 | §5.1 e-posta bloğu, `agentOk` kapısı                                                                                |
| 413 | §6, `targets.resolve` K1, eski fonksiyonlara delegasyon                                                             |
| 414 | §7 ilk iki satır, mevcut audit; eski uçlar korunur                                                                  |
| 415 | §4.5 HMAC doğrulama, `code-dialog`                                                                                  |
| 416 | §6 K2, 404 kuralı, `UNATTENDED_DISABLED`                                                                            |
| 417 | §4.4 adım 3, `recipientsLocked`                                                                                     |
| 418 | §5.2                                                                                                                |
| 419 | §3.1 belirteç, `GET /public/unattended/download`, §7 IP 20/dk                                                       |
| 420 | `sent_count` ≤ 3, ortak kovalar, `unattended.code.sent`                                                             |
| 421 | `customer-actions.tsx` görünürlüğü, `targets.resolve` K3 409                                                        |
| 422 | §5.3, güncel `request_ref`                                                                                          |
| 423 | §6 K3, §7, `customer.link_sent`                                                                                     |
| 424 | §5 ortak kurallar, birim testi                                                                                      |
| 425 | §8 log/metrik/redact, log yakalama testi                                                                            |
| 426 | §9 a11y ve görünüm, e2e axe                                                                                         |
| 427 | §12 e2e                                                                                                             |
| 428 | LG-5                                                                                                                |

## 15. Açık kararlar ve AC değişiklik talepleri

| #      | Konu                                                                     | Karar / talep                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KD-LG1 | AC-419 "rastgele" ifadesi                                                | Belirteç sunucu anahtarlı PRF ile türetilir (§3.1). PY'den AC metninin güncellenmesi istenir. guvenlik onaylar.                                                           |
| KD-LG2 | K2 WhatsApp, güvensiz http taşımada kapalı                               | §10.2. AC-406'nın "kullanılabilir" tanımına dahildir; AC değişikliği gerekmez.                                                                                            |
| KD-LG3 | K2'de ikili kapısı kapalıysa kanal yok (K1'de yalnız satır düşer)        | §5.2. AC-412 yalnız K1'i bağlar.                                                                                                                                          |
| KD-LG4 | Eski K1 uçları (AC-414 için) korunur, web kullanmaz                      | İki uç da aynı servis fonksiyonunu çağırır. Kaldırılması Sonra (LG-S5) yapılır: P10 ve P19 testleri yeni uca taşındığında.                                                |
| KD-LG5 | V-LG6: K2 önizlemesi indirme bağlantısını metnin parçası olarak gösterir | AC-407 ("metnin tamamı") önceliklidir. Bağlantı ayrıca listelenmez, kopyala düğmesi yoktur. Önizlemeyi görebilen yalnız kodun kendisini zaten gören üretici kullanıcıdır. |
| KD-LG6 | Başarısız dış gönderim K2 hakkını geri vermez                            | §4.4 adım 7 (taciz döngüsünü önler).                                                                                                                                      |
| LG-S5  | Eski K1 uçlarının kaldırılması                                           | Sonra                                                                                                                                                                     |
