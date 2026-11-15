// GET /unattended/download (`manage`; mimari-p27 §4.2, §8.1): servis ikilisi. `AgentBinary` bütünlük kapısı yeniden kullanılır
// (UNATTENDED_AGENT_PATH + UNATTENDED_AGENT_SHA256; yapılandırma yok / dosya yok / SHA uyuşmuyor → 503 fail-closed). Dosya
// oturumlu uçtan akıtılır (Caddy /downloads public yoluna konmaz — kayıt kodu üretimi `manage` ister, ikili de öyle).
import { createReadStream } from "node:fs";
import type { FastifyReply } from "fastify";
import { AgentBinary } from "../public/agent-binary.ts";
import { AppError } from "../lib/errors.ts";

export const SERVICE_FILE_NAME = "NoktaDestekServis.exe";

export function serviceBinary(path: string | undefined, sha256: string | undefined, warn: (state: string) => void): AgentBinary {
  return new AgentBinary(path, sha256, warn);
}

export async function sendServiceBinary(bin: AgentBinary, path: string | undefined, reply: FastifyReply): Promise<FastifyReply> {
  if ((await bin.check()) !== "ok" || !path) throw new AppError("NOT_READY", { message: "Servis programı şu an indirilemiyor." });
  return reply
    .header("Content-Type", "application/vnd.microsoft.portable-executable")
    .header("Content-Disposition", `attachment; filename="${SERVICE_FILE_NAME}"`)
    .header("X-Content-Type-Options", "nosniff")
    .send(createReadStream(path));
}
