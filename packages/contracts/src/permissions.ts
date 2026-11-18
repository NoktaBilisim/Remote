// Yetki anahtarlarının TEK tanımı (AC-71, AC-72; mimari-api.md "Yetki anahtarları").
// Toggle ekranı, sunucu `requirePerm` ve /auth/me bu listeden üretilir; başka yerde elle liste tutulmaz.
// Yeni modül/alt yetki yalnız buraya eklenir.

export const PERMISSION_MODULES = [
  // P19 (AC-260): send_link = oturum bağlantısını müşteriye SMS/WhatsApp ile gönder (+ sessions.create). LG (V-LG3): K3 müşteri
  // bağlantıları da bu anahtarla (+ customers.view) — etiket "Müşteriye bağlantı gönder".
  // P28e (AC-385, 404; mimari-p28e §4): view_recording = oturum kayıtlarını izle (+ session_history.view + historyScope).
  // P28c (AC-364, 368, 404; mimari-p28c §9): invite = etkin oturuma aynı firmadan teknisyen davet et, kontrolü/oturumu devret
  // (yalnız oturum sahibi); supervise = firmanın etkin oturumlarını izleyici olarak "İzle". Rol varsayılanı Admin açık / User kapalı.
  // P28d (AC-373, 378; mimari-p28d §7): voice = etkin oturumda müşteriyle sesli görüşme başlat, katıl ve DİNLE (izleyici de
  // dinlemek için ister — V-PD-6). Rol varsayılanı Admin açık / User kapalı.
  {
    key: "sessions",
    actions: ["view", "create", "edit", "delete", "terminate", "send_link", "view_recording", "invite", "supervise", "voice"],
  },
  // P28a (AC-343, 348, 404; mimari-p28 §4.1): clipboard = düz metin pano gönder/al (kontrol GRANTED + müşteri izni);
  // print = PDF'i müşterinin varsayılan yazıcısına gönder — `file_transfer.use`'dan BAĞIMSIZ (yalnız Windows istemci).
  { key: "remote_control", actions: ["use", "clipboard"] },
  { key: "file_transfer", actions: ["use", "print"] },
  { key: "session_history", actions: ["view", "edit", "export"] },
  // P8b (AC-147): view = kuyruk, geçmiş, panel bildirimi; accept = kabul VE ret (sessions.create gerekmez, mimari-e9 §4).
  // P15 (AC-235): block = talep engelleri (IP/önek, cihaz) listele/ekle/kaldır.
  // P18 (AC-256, 257; S-P18-T3): assign = talebi teknisyene ata / atamayı kaldır / önceliği değiştir; message = bekleyen
  // talepte müşteriye mesaj yaz (uç H3).
  { key: "support_requests", actions: ["view", "accept", "block", "assign", "message"] },
  // P8c (AC-165): view = liste, detay, Genel bağlantı, oturumda seçim; edit = düzenle, bağlantıyı yenile, yeniden aktif et,
  // tek kayıt iptali; delete = PASİFE ALMA (kalıcı silme yok — V23).
  // P19 (AC-263, S-P19-14): export = CSV indir (+ view); import = CSV önizleme (+ create + view) / uygulama (+ create,
  // güncellemede + edit). Bağımlılık toggle kaydında değil uçta zorlanır (K-P19-9).
  { key: "customers", actions: ["view", "create", "edit", "delete", "export", "import"] },
  // P27 (AC-273, 275, 293, 296; mimari-p27 §4.1): connect = yetkili olduğu cihaza bağlan (+ cihaz grant'ı + step-up);
  // manage = tüm cihazları gör, kayıt kodu üret/iptal, teknisyen–cihaz yetkisi ver/al, cihazı iptal et, bildirim adresleri.
  // Müdahale (kilitle/oturumu kapat) için ayrı anahtar YOK (V-PU7): `connect` + grant + oturumun teknisyeni olmak.
  { key: "unattended", actions: ["connect", "manage"] },
  { key: "users", actions: ["view", "create", "edit", "delete"] },
  { key: "settings", actions: ["view", "edit"] },
  { key: "audit", actions: ["view", "export"] },
] as const;

type PermissionModule = (typeof PERMISSION_MODULES)[number];
export type PermissionKey = PermissionModule extends infer M
  ? M extends { key: infer K extends string; actions: readonly (infer A extends string)[] }
    ? `${K}.${A}`
    : never
  : never;

/** Modül tanımından anahtar listesi (`modül.eylem`). AC-72 testi geçici modülle aynı üretimi kullanır. */
export function permissionKeysOf(modules: readonly { key: string; actions: readonly string[] }[]): PermissionKey[] {
  return modules.flatMap((m) => m.actions.map((a) => `${m.key}.${a}` as PermissionKey));
}

export const PERMISSION_KEYS: readonly PermissionKey[] = permissionKeysOf(PERMISSION_MODULES);

/**
 * Mezar listesi (S-P28u-r3-3): kaldırılmış yetki anahtarları — bu adlar YENİDEN KULLANILMAZ. `user_permissions`'ta saklı
 * `granted=true` satırları kalmış olabilir (expand-only; satır kullanıcı kaydında silinir, K-P28u-r3-8); aynı ad yeniden
 * tanımlanırsa eski satırlar kendiliğinden yetki verirdi. Birim test: `PERMISSION_KEYS` ile kesişim boş.
 * `unattended.silent`: P28u r3 (K-P28u-r3-7) — izinsiz (silent) kip kaldırıldı.
 */
export const RETIRED_PERMISSION_KEYS: readonly string[] = ["unattended.silent"];

/**
 * P9 (mimari-e9 §13.2): toggle ekranında alt yetki açıklaması — yalnız davranışı adından anlaşılmayan anahtarlar.
 * Etiketler web sözlüğündedir; açıklama yoksa ekran yalnız etiketi gösterir.
 */
export const PERMISSION_DESCRIPTIONS: Readonly<Partial<Record<PermissionKey, string>>> = {
  "sessions.terminate": "Etkin bir destek oturumunu yönetici olarak zorla sonlandırır.",
  "sessions.send_link":
    "Müşteriye bağlantı gönderir: oturum bağlantısını SMS/WhatsApp ile ve müşteriye özel indirme/talep bağlantılarını e-posta/WhatsApp ile.",
  "support_requests.accept":
    "Talep kabul et — kabul edilen talep için oturum açar (Oturum oluşturma yetkisi gerekmez; açık oturum sınırı geçerlidir). Reddetme de bu yetkiyle yapılır.",
  "customers.delete": "Müşteriyi pasife alır (kalıcı silme yoktur).",
  "customers.export": "Müşteri listesini CSV olarak indirir.",
  "customers.import":
    "CSV'den müşteri ekler/günceller. Ekle ve Görüntüle yetkisiyle birlikte çalışır (var olanları güncellemek için Düzenle de gerekir).",
  "users.edit": "Kullanıcı bilgilerini, rolünü ve yetkilerini değiştirir; kullanıcıyı pasife alır veya yeniden etkinleştirir.",
  "support_requests.block":
    "Belirli bir IP adresinden/ağdan veya bilgisayardan gelen destek taleplerini engeller; engelleri listeler ve kaldırır.",
  "support_requests.assign": "Talebi teknisyene atar ve önceliğini değiştirir.",
  "support_requests.message": "Bekleyen talepte müşteriye mesaj yazar.",
  // P15 (AC-237): anahtar kalıcı kullanıcı silme ucunu korur (uç P16, ADR-0030). Pasife alma "Düzenle" yetkisiyle yapılır.
  // P16 (AC-237/241): DELETE /users/:id — yalnız pasif kullanıcı, ad onayı + step-up.
  "users.delete": 'Pasif kullanıcıyı kalıcı siler (geri alınamaz). Pasife alma "Düzenle" yetkisiyle yapılır.',
  // P27 (§4.1): cihaz yetkisi olmadan `connect` tek başına bağlantı açmaz (AC-293).
  "unattended.connect":
    "Yetki verilmiş gözetimsiz cihazlara müşteri onayı olmadan bağlanır. Her bağlantıda iki adımlı doğrulama kodu istenir; cihaz bazında yetki ayrıca verilmelidir.",
  "remote_control.clipboard": "Kontrol izni verilmiş oturumda, müşteri ayrıca izin verirse düz metin panosunu gönderir ve alır.",
  "file_transfer.print": "Müşterinin onayıyla PDF belgeyi müşterinin varsayılan yazıcısına gönderir (yalnız Windows uygulaması).",
  "unattended.manage":
    "Tüm gözetimsiz cihazları görür; kayıt kodu üretir, teknisyenlere cihaz yetkisi verir/alır, cihazı iptal eder ve müşteri bildirim adreslerini düzenler.",
  // P28e (§4, V54): toggle ekranı uyarı tonuyla gösterir (AC-404 kalıbı).
  "sessions.view_recording": "Oturum kayıtlarını izler (hassas — yalnız gerekene verin).",
  // P28c (mimari-p28c §9): `supervise` toggle ekranında uyarı tonuyla (AC-404 kalıbı).
  "sessions.invite": "Etkin oturuma aynı firmadan teknisyen davet eder, kontrolü ve oturumu devreder.",
  "sessions.supervise": "Firmanın etkin oturumlarını izleyici olarak izler (hassas — yalnız gerekene verin).",
  // P28d (mimari-p28d §7): dinlemeyi de kapsar — yetkisiz teknisyen (rol fark etmez) görüşmeyi duymaz (V-PD-6).
  "sessions.voice": "Etkin oturumda müşteriyle sesli görüşme başlatır, katılır ve görüşmeyi dinler.",
};

export const ROLES = ["SUPER_ADMIN", "ADMIN", "USER"] as const;
export type Role = (typeof ROLES)[number];

export interface PermissionOverride {
  permKey: string;
  granted: boolean;
}

/**
 * Etkin yetkiler (AC-73): SUPER_ADMIN tümü (toggle değil, rol); ADMIN varsayılan tümü açık,
 * USER varsayılan tümü kapalı; `user_permissions` satırları varsayılanı kullanıcı bazında ezer.
 * Tanımda olmayan (eski) anahtarlar yok sayılır.
 */
export function effectivePermissions(role: Role, overrides: readonly PermissionOverride[]): PermissionKey[] {
  return effectivePermissionsFrom(PERMISSION_KEYS, role, overrides);
}

/** `effectivePermissions`'ın verilen anahtar listesiyle çalışan hâli (AC-72 testi geçici anahtarla aynı kuralı kullanır). */
export function effectivePermissionsFrom(
  keys: readonly PermissionKey[],
  role: Role,
  overrides: readonly PermissionOverride[],
): PermissionKey[] {
  if (role === "SUPER_ADMIN") return [...keys];
  const byKey = new Map(overrides.map((o) => [o.permKey, o.granted]));
  const defaultGranted = role === "ADMIN";
  return keys.filter((key) => byKey.get(key) ?? defaultGranted);
}

/** Rol varsayılanı (AC-73): ADMIN açık, USER kapalı (SUPER_ADMIN toggle'a tabi değil, tümü açık). */
export const roleDefaultGranted = (role: Role): boolean => role !== "USER";
