/*
 * P27 gözetimsiz erişim sözleşmesinin web yüzü: tek kaynak `@remote/contracts/api/unattended` (mimari-p27 §4.2, §6).
 * Burada şema/alan tanımı yok; yalnız yeniden dışa aktarım (PT-D3 kalıbı).
 */
export {
  CONNECT_BLOCKED_REASON_LABELS,
  CONSENT_MODE_LABELS,
  DEVICE_USER_STATE_LABELS,
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
  // P29 (mimari-p29 §4.8, §6; AC-490): sürüm sütunu rozetleri ve dağılım şeridi
  DEVICE_UPDATE_BADGE_LABELS,
  DEVICE_UPDATE_BADGES,
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
  UnattendedStatus,
  DeviceUpdateBadge,
  DeviceVersionRow,
  DeviceVersionsResponse,
  PublishedUpdate,
} from "@remote/contracts/api/unattended";
export { UPDATE_REASON_LABELS, UPDATE_VERSION_PATTERN, type UpdatePlatform, type UpdateReason } from "@remote/contracts/api/update";
export { CONSENT_MODES, type ConsentMode, type DeviceUserState } from "@remote/contracts/unattended-consent";
export { REJOIN_WINDOW_SEC } from "@remote/contracts/rejoin-const";
