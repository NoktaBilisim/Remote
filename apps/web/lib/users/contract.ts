/*
 * P9 kullanıcı ve firma (tenant) yönetimi sözleşmesinin web yüzü: tek kaynak `@remote/contracts/api/{users,tenants}`
 * (docs/mimari-api.md "Yönetim"). Burada şema/alan tanımı yok; yalnız yeniden dışa aktarım.
 */
export {
  USER_EMAIL_MAX,
  USER_FULL_NAME_MAX,
  USER_PAGE_SIZE_DEFAULT,
  USER_ROLE_FILTERS,
  USER_STATUS_FILTERS,
  USER_STALE_WRITE_MESSAGE,
  USER_DELETE_CONFIRM_MISMATCH_MESSAGE,
  createUserInputSchema,
  userEtag,
} from "@remote/contracts/api/users";
export type {
  CreateUserInput,
  CreateUserResponse,
  ManagedRole,
  UpdateUserInput,
  UserDetail,
  UserListItem,
  UserListResponse,
  UserOptionsResponse,
  UserRoleFilter,
  UserStatusFilter,
} from "@remote/contracts/api/users";
export {
  TENANT_NAME_MAX,
  TENANT_PAGE_SIZE_DEFAULT,
  TENANT_SLUG_CONFLICT_MESSAGE,
  TENANT_SLUG_MAX,
  TENANT_OPTIONS_MAX,
  createTenantInputSchema,
} from "@remote/contracts/api/tenants";
export type {
  CreateTenantInput,
  SwitchTenantResponse,
  TenantItem,
  TenantListResponse,
  TenantOption,
  TenantOptionsResponse,
  UpdateTenantInput,
} from "@remote/contracts/api/tenants";
