/**
 * Sıfırlama bağlantısından token: yalnız URL parçası (`#token=…`, contracts RESET_PASSWORD_PATH). Parça sunucuya,
 * proxy loguna ve Referer'a gitmez; sorgu dizesi (`?token=`) bilerek kabul edilmez.
 */
export function readResetToken(loc: { hash: string }): string | null {
  return new URLSearchParams(loc.hash.replace(/^#/, "")).get("token");
}
