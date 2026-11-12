/*
 * P11 sistem ayarları (MySQL, TURN) ve aydınlatma metni sözleşmesinin web yüzü: tek kaynak
 * `@remote/contracts/api/system-settings` (docs/mimari-api.md "Yönetim"; AC-77, 78; ADR-0003). Yalnız yeniden dışa aktarım.
 */
export {
  CONSENT_BODY_MAX,
  CONSENT_BODY_MIN,
  MYSQL_APPLY_NOTE,
  MYSQL_DEFAULT_PORT,
  MYSQL_PASSWORD_REQUIRED_MESSAGE,
  MYSQL_TEST_TIMEOUT_MS,
  TURN_SECRET_REQUIRED_MESSAGE,
  TURN_URLS_MAX,
  consentTextInputSchema,
  mysqlSettingsInputSchema,
  turnSettingsInputSchema,
} from "@remote/contracts/api/system-settings";
export type {
  ConsentTextSaveResponse,
  ConsentTextSettings,
  ConsentTextVersion,
  MysqlSettingsData,
  MysqlSettingsSaveResponse,
  MysqlSettingsView,
  MysqlTestResponse,
  TurnSettingsData,
  TurnSettingsView,
} from "@remote/contracts/api/system-settings";
