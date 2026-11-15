// multipart/form-data okuma (AC-84): tek dosya alanı `file`, en çok 2 MB (aşım 413 `PAYLOAD_TOO_LARGE`). Dosya adı
// ve istemcinin bildirdiği MIME türü KULLANILMAZ (tür image.ts'de içerikten belirlenir). Gövde sınırı Content-Length
// varsa okumadan önce de denetlenir.
import { UPLOAD_FIELD, UPLOAD_MAX_BYTES } from "@remote/contracts/api/branding";
import type { FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.ts";

/** Çok parçalı zarf payı (sınır dizgileri, başlıklar). */
const ENVELOPE_SLACK = 16 * 1024;

const noFile = (): AppError => new AppError("VALIDATION", { fields: { [UPLOAD_FIELD]: "Bir resim dosyası seçin." } });

function codeOf(err: unknown): string {
  return typeof err === "object" && err !== null ? String((err as { code?: unknown }).code ?? "") : "";
}

function mapError(err: unknown): AppError {
  const code = codeOf(err);
  if (code === "FST_REQ_FILE_TOO_LARGE" || code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT")
    return new AppError("PAYLOAD_TOO_LARGE");
  return noFile();
}

export async function readUpload(req: FastifyRequest): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > UPLOAD_MAX_BYTES + ENVELOPE_SLACK) throw new AppError("PAYLOAD_TOO_LARGE");
  if (!req.isMultipart()) throw noFile();
  let data: Buffer;
  try {
    const part = await req.file({ limits: { fileSize: UPLOAD_MAX_BYTES, files: 1, fields: 0, parts: 1 } });
    if (!part || part.fieldname !== UPLOAD_FIELD) {
      part?.file.resume();
      throw noFile();
    }
    data = await part.toBuffer();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw mapError(err);
  }
  if (data.length === 0) throw noFile();
  return data;
}
