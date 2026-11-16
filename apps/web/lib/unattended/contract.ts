/*
 * P27 gözetimsiz erişim sözleşmesinin web yüzü: tek kaynak `@remote/contracts/api/unattended` (mimari-p27 §4.2, §6).
 * Burada şema/alan tanımı yok; yalnız yeniden dışa aktarım (PT-D3 kalıbı).
 */
export {
  CONNECT_BLOCKED_REASON_LABELS,
  CONSENT_MODE_LABELS,
  DEVICE_USER_STATE_LABELS,
  SILENT_REASON_MAX,
  SILENT_REASON_MIN,
  DEVICE_LIST_STATES,
  DEVICE_PAGE_SIZE,
  DEVICE_PAGE_SIZE_MAX,
  DEVICE_POLL_MS,
  NOTIFY_CONTACTS_MAX,
  REGISTRATION_CODE_TTL_HOURS,
  UNATTENDED_ERROR_MESSAGES,
  UNATTENDED_OFF_BANNER,
  UNATTENDED_TEST_BANNER,
  putNotifyContactsInputSchema,
} from "@remote/contracts/api/unattended";
export type {
  ConnectBlockedReason,
  CreatedRegistrationCode,
  DeviceDetail,
  DeviceGrant,
  DeviceGrantsResponse,
  DeviceListItem,
  DeviceListResponse,
  DeviceListState,
  NotifyContact,
  NotifyContactsResponse,
  PutNotifyContactsInput,
  RegistrationCodeItem,
  RegistrationCodeListResponse,
  InterveneLogoffResponse,
  UnattendedConnectInput,
  UnattendedConnectResponse,
  UnattendedPolicyView,
  UnattendedStatus,
} from "@remote/contracts/api/unattended";
export { CONSENT_MODES, CONSENT_DIALOG_SEC, type ConsentMode, type DeviceUserState } from "@remote/contracts/unattended-consent";
export { REJOIN_WINDOW_SEC } from "@remote/contracts/rejoin-const";
