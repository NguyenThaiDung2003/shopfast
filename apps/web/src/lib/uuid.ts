const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Id trên URL phải là UUID (khớp ParseUuidPipe của API) – sai thì không gọi API. */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}
