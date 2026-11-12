/*
 * P8c müşteri firmalar sözleşmesinin web yüzü: tek kaynak `@remote/contracts/api/customers`
 * (docs/mimari-api.md "Müşteriler ve bilgisayar kaydı (P8c)"). Burada şema/alan tanımı yok; yalnız yeniden dışa aktarım.
 */
export {
  CUSTOMER_CONTACT_MAX,
  CUSTOMER_EMAIL_MAX,
  CUSTOMER_NAME_CONFLICT_MESSAGE,
  CUSTOMER_NAME_MAX,
  CUSTOMER_NOTE_MAX,
  CUSTOMER_PAGE_SIZE_DEFAULT,
  CUSTOMER_STATUS_FILTERS,
  CUSTOMER_TAB_PAGE_SIZE_DEFAULT,
  FILE_LABEL_MAX,
  createCustomerInputSchema,
  suggestFileLabel,
  updateCustomerInputSchema,
} from "@remote/contracts/api/customers";
export type {
  CreateCustomerInput,
  CustomerDetail,
  CustomerFirmRef,
  CustomerListItem,
  CustomerListResponse,
  CustomerOptionsResponse,
  CustomerStatus,
  CustomerStatusFilter,
  GeneralLinkResponse,
  UpdateCustomerInput,
} from "@remote/contracts/api/customers";
