/*
 * P9 kullanıcı ve firma (tenant) yönetimi sözleşmesinin web yüzü: tek kaynak `@remote/contracts/api/{users,tenants}`
 * (docs/mimari-api.md "Yönetim"). Burada şema/alan tanımı yok; yalnız yeniden dışa aktarım.
 */
export {
  MANAGED_ROLES,
  USER_EMAIL_CONFLICT_MESSAGE,
  USER_EMAIL_MAX,
  USER_FULL_NAME_MAX,
  USER_PAGE_SIZE_DEFAULT,
  USER_ROLE_FILTERS,
  USER_STATUS_FILTERS,
  createUserInputSchema,
  updateUserInputSchema,
} from "@remote/contracts/api/users";
export type {
  CreateUserInput,
  CreateUserResponse,
  ManagedRole,
  UpdateUserInput,
  UserDetail,
  UserListItem,
  UserListResponse,
  UserRoleFilter,
  UserStatus,
  UserStatusFilter,
} from "@remote/contracts/api/users";
export {
  TENANT_NAME_MAX,
  TENANT_PAGE_SIZE_DEFAULT,
  TENANT_SLUG_CONFLICT_MESSAGE,
  TENANT_SLUG_MAX,
  createTenantInputSchema,
  updateTenantInputSchema,
} from "@remote/contracts/api/tenants";
export type {
  CreateTenantInput,
  SwitchTenantInput,
  SwitchTenantResponse,
  TenantItem,
  TenantListResponse,
  TenantStatus,
  UpdateTenantInput,
} from "@remote/contracts/api/tenants";
