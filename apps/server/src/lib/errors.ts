// Tipli uygulama hataları ve standart hata zarfı (mimari-api.md "Ortak kurallar").
// Bilinmeyen hatalar loglanır, kullanıcıya yalnız 500 + requestId döner (stack/SQL sızmaz).
import { BINDING_INVALID_MESSAGE } from "@remote/contracts/api/bindings";
import { ERROR_STATUS, type ErrorCode, type ErrorEnvelope } from "@remote/contracts/errors";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { isTransientDbError } from "./db.ts";

/** Geçici DB çekişmesinde (QA-P8b-1) istemciye önerilen bekleme; TX geri alındığı için yeniden deneme güvenli. */
export const DB_BUSY_RETRY_SEC = 5;
export const DB_BUSY_MESSAGE = "Sunucu şu an yoğun. Lütfen birkaç saniye sonra tekrar deneyin.";

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION: "Gönderilen bilgiler geçersiz.",
  UNAUTHENTICATED: "Oturum bulunamadı. Lütfen giriş yapın.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  CSRF_INVALID: "İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.",
  PASSWORD_CHANGE_REQUIRED: "Devam etmeden önce şifrenizi değiştirmeniz gerekiyor.",
  NOT_FOUND: "Kayıt bulunamadı.",
  METHOD_NOT_ALLOWED: "Bu işlem bu kaynakta desteklenmiyor.",
  CONFLICT: "Kayıt bu işlem için uygun durumda değil.",
  OPEN_SESSION_LIMIT: "Açık oturum sınırına ulaştınız. Yeni oturum için bekleyen bir oturumu iptal edin.",
  LOBBY_FULL: "Bu oturumda bekleyen katılımcı sınırı doldu. Lütfen teknisyeninizle görüşün.",
  SESSION_EXPIRED: "Bağlantının süresi doldu.",
  SESSION_CONSUMED: "Bu bağlantı zaten kullanıldı.",
  SESSION_CANCELLED: "Oturum iptal edildi.",
  NONCE_INVALID: "Sayfanın süresi doldu. Lütfen bağlantıyı yeniden açın.",
  ACCOUNT_LOCKED: "Çok fazla hatalı deneme. Hesap geçici olarak kilitlendi.",
  RATE_LIMITED: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin.",
  INTERNAL: "Beklenmeyen bir hata oluştu.",
  NOT_READY: "Servis hazır değil.",
  BINDING_INVALID: BINDING_INVALID_MESSAGE,
  REQUEST_REF_INVALID: "Bu dosya artık geçerli değil; firmanızdan yenisini isteyin.",
  REQUEST_PENDING: "Bu pencereden gönderilmiş, bekleyen bir talebiniz zaten var.",
  REQUEST_TAKEN: "Talep başka bir teknisyen tarafından alındı.",
  REQUEST_CLOSED: "Talep artık açık değil (iptal, süre dolumu veya ret).",
  QUEUE_FULL: "Şu an çok yoğunuz, lütfen firmanızı telefonla arayın.",
  CLIENT_OUTDATED: "Bu Hızlı Destek dosyası eski. Güvenliğiniz için yeni sürümü indirin.",
  UPSTREAM: "Servise ulaşılamadı.",
  HOST_NOT_ALLOWED: "Bu sunucu adresi kullanılamaz.",
  MFA_REQUIRED: "Devam etmek için iki adımlı doğrulama kodunu girin.",
  MFA_SETUP_REQUIRED: "Devam etmeden önce iki adımlı doğrulamayı kurmanız gerekiyor.",
  RESET_TOKEN_INVALID: "Bu şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş. Yeni bağlantı isteyin.",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;
  readonly retryAfterSec: number | undefined;

  constructor(code: ErrorCode, opts: { message?: string; fields?: Record<string, string>; retryAfterSec?: number } = {}) {
    super(opts.message ?? DEFAULT_MESSAGES[code]);
    this.code = code;
    this.fields = opts.fields;
    this.retryAfterSec = opts.retryAfterSec;
  }
}

/** zod ile girdi doğrulama; hata → VALIDATION + alan bazlı mesajlar. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw new AppError("VALIDATION", { fields });
}

function send(reply: FastifyReply, req: FastifyRequest, err: AppError): FastifyReply {
  const body: ErrorEnvelope = {
    error: { code: err.code, message: err.message, requestId: req.id, ...(err.fields ? { fields: err.fields } : {}) },
  };
  if (err.retryAfterSec !== undefined) void reply.header("Retry-After", String(err.retryAfterSec));
  return reply.status(ERROR_STATUS[err.code]).send(body);
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, req, reply) => {
    if (error instanceof AppError) return send(reply, req, error);
    const status = (error as FastifyError).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      // Fastify istemci hataları (bozuk JSON, içerik türü, gövde boyutu) → genel doğrulama hatası.
      req.log.info({ code: (error as FastifyError).code }, "istemci hatası");
      return send(reply, req, new AppError("VALIDATION"));
    }
    if (isTransientDbError(error)) {
      // Kilit/havuz/TX bekleme aşımı: yazma geri alındı, karar verilmedi → 503 + Retry-After (5xx-500 değil).
      req.log.warn({ alarm: "db_busy", code: (error as { code?: unknown }).code }, "geçici DB çekişmesi");
      return send(reply, req, new AppError("NOT_READY", { message: DB_BUSY_MESSAGE, retryAfterSec: DB_BUSY_RETRY_SEC }));
    }
    req.log.error({ err: error }, "beklenmeyen hata");
    return send(reply, req, new AppError("INTERNAL"));
  });
  app.setNotFoundHandler((req, reply) => send(reply, req, new AppError("NOT_FOUND")));
}
