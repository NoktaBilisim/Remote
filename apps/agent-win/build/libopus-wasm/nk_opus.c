/* P28d (ADR-0036 yedek 1, A-PD-1): libopus 1.6.1'in WebAssembly yüzü. Go tarafı (internal/voice/opus.go) yalnız bu
 * dosyanın dışa aktardığı nk_* işlevlerini çağırır; opus_*_ctl değişken argümanlı olduğu için doğrudan dışa aktarılmaz.
 * Her wazero örneği (instance) ayrı doğrusal bellek taşır: bir örnek ya tek kodlayıcı ya tek çözücü barındırır.
 * Biçim sabit (ADR-0036 m.1): 48 kHz, mono; kodlayıcı VOIP, 20 ms. Tampon üst sınırları Go sabitleriyle aynıdır. */
#include <opus.h>

#define NK_EXPORT(name) __attribute__((export_name(#name)))
#define NK_MAX_PACKET 1275 /* RFC 6716 §3.2.1 */
#define NK_MAX_FRAME 5760  /* 120 ms @ 48 kHz */
#define NK_ENC_FRAME 960   /* 20 ms @ 48 kHz */

/* Yerleşim sabit (tek yapı): Go testi (TestP28dK0sTrapIsolatedPerInstance) durum işaretçisinin adresini buradan bilir
 * ve tuzağı bilerek tetikler. packet @0, samples @1276, encoder @12796, decoder @12800 (nk_packet_buf'a göre). */
static struct {
  unsigned char packet[NK_MAX_PACKET];
  opus_int16 samples[NK_MAX_FRAME];
  OpusEncoder *encoder;
  OpusDecoder *decoder;
} nk;
_Static_assert(__builtin_offsetof(__typeof__(nk), samples) == 1276, "yerleşim");
_Static_assert(__builtin_offsetof(__typeof__(nk), encoder) == 12796, "yerleşim");
_Static_assert(__builtin_offsetof(__typeof__(nk), decoder) == 12800, "yerleşim");
#define nk_packet nk.packet
#define nk_samples nk.samples
#define nk_encoder nk.encoder
#define nk_decoder nk.decoder

NK_EXPORT(nk_packet_buf) unsigned char *nk_packet_buf(void) { return nk_packet; }
NK_EXPORT(nk_pcm_buf) opus_int16 *nk_pcm_buf(void) { return nk_samples; }

NK_EXPORT(nk_enc_init) int nk_enc_init(int bitrate, int complexity) {
  int err;
  if (nk_encoder || nk_decoder) return OPUS_INVALID_STATE;
  nk_encoder = opus_encoder_create(48000, 1, OPUS_APPLICATION_VOIP, &err);
  if (err != OPUS_OK) return err;
  if ((err = opus_encoder_ctl(nk_encoder, OPUS_SET_BITRATE(bitrate))) != OPUS_OK) return err;
  if ((err = opus_encoder_ctl(nk_encoder, OPUS_SET_VBR(1))) != OPUS_OK) return err;
  return opus_encoder_ctl(nk_encoder, OPUS_SET_COMPLEXITY(complexity));
}

/* nk_samples[0..959] → nk_packet; dönüş paket boyu veya negatif OPUS_* hatası. */
NK_EXPORT(nk_enc) int nk_enc(void) {
  if (!nk_encoder) return OPUS_INVALID_STATE;
  return opus_encode(nk_encoder, nk_samples, NK_ENC_FRAME, nk_packet, NK_MAX_PACKET);
}

NK_EXPORT(nk_enc_lookahead) int nk_enc_lookahead(void) {
  opus_int32 v;
  int err;
  if (!nk_encoder) return OPUS_INVALID_STATE;
  if ((err = opus_encoder_ctl(nk_encoder, OPUS_GET_LOOKAHEAD(&v))) != OPUS_OK) return err;
  return v;
}

NK_EXPORT(nk_dec_init) int nk_dec_init(void) {
  int err;
  if (nk_encoder || nk_decoder) return OPUS_INVALID_STATE;
  nk_decoder = opus_decoder_create(48000, 1, &err);
  return err;
}

/* nk_packet[0..len) → nk_samples; len 0 = kayıp (PLC). Dönüş örnek sayısı veya negatif OPUS_* hatası. */
NK_EXPORT(nk_dec) int nk_dec(int len, int frame, int fec) {
  if (!nk_decoder) return OPUS_INVALID_STATE;
  if (len < 0 || len > NK_MAX_PACKET || frame <= 0 || frame > NK_MAX_FRAME) return OPUS_BAD_ARG;
  return opus_decode(nk_decoder, len ? nk_packet : 0, len, nk_samples, frame, fec != 0);
}
