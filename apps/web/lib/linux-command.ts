/**
 * P28g (mimari-p28g §4.3, S-P28g-6 — bağlayıcı metin; AC-397): Linux rehberindeki kopyalanabilir başlatma komutu.
 * İndirilenler klasöründe son 30 dakikadaki, istemcinin `folderCode` desenine uyan en yeni **tek** normal dosyayı seçer,
 * yalnız ona `u+x` verir ve çalıştırır. Sabit metindir: sunucu verisi, kod ya da ref içermez (enjeksiyon yüzeyi yok).
 *
 * Kopyalanan bayt dizisi = ekranda görünen metin = bu sabit. Baştaki tek boşluk bilerek vardır (Ubuntu varsayılanı
 * `HISTCONTROL=ignoreboth` → komut geçmişe yazılmaz). Sonda satır sonu yok, `sudo` yok. `\n` iki karakterlik `printf`
 * biçimidir (gerçek satır sonu değil) — bu yüzden metin `tr.json`/`t()` üzerinden geçmez (JSON kaçışı ve `{8}` yer tutucu
 * olarak bozulurdu). Değişiklik yalnız mimari §4.3 ile birlikte yapılır (birim testi belgeyle bayt bayt karşılaştırır).
 */
export const LINUX_RUN_COMMAND = String.raw` d="$(xdg-user-dir DOWNLOAD)" && [ -d "$d" ] && cd "$d" && f="$(find . -maxdepth 1 -type f -mmin -30 -regextype posix-extended -regex './Destek-[0-9]{8}( ?\([0-9]{1,3}\))?' -printf '%T@ %f\n' | sort -nr | head -n 1 | cut -d' ' -f2-)" && [ -n "$f" ] && chmod u+x -- "$f" && ./"$f"`;
