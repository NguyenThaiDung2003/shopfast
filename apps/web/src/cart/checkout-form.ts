// Form "Địa chỉ nhận hàng": validate khớp ShippingInfoDto của API và ghép địa chỉ gửi đi.

import type { ShippingInfo } from './cart-api';

export interface CheckoutForm {
  recipientName: string;
  phone: string;
  province: string;
  district: string;
  street: string;
  note: string;
}

export type CheckoutErrors = Partial<Record<keyof CheckoutForm, string>>;

export const EMPTY_CHECKOUT_FORM: CheckoutForm = {
  recipientName: '',
  phone: '',
  province: '',
  district: '',
  street: '',
  note: '',
};

export const MAX_NOTE_LENGTH = 500;
const VN_PHONE = /^(0|\+84)\d{9}$/;

/** Cho phép gõ "0912 345 678", "0912.345.678"; API nhận dạng liền. */
const normalizePhone = (phone: string) => phone.replace(/[\s.-]/g, '');

export function validateCheckout(form: CheckoutForm): CheckoutErrors {
  const errors: CheckoutErrors = {};
  const name = form.recipientName.trim();
  if (!name) errors.recipientName = 'Vui lòng nhập họ tên người nhận.';
  else if (name.length < 2 || name.length > 100)
    errors.recipientName = 'Họ tên từ 2 đến 100 ký tự.';

  if (!form.phone.trim()) errors.phone = 'Vui lòng nhập số điện thoại.';
  else if (!VN_PHONE.test(normalizePhone(form.phone))) {
    errors.phone = 'Số điện thoại không hợp lệ (ví dụ 0912345678).';
  }

  if (!form.province.trim()) errors.province = 'Vui lòng nhập tỉnh/thành phố.';
  else if (form.province.trim().length > 60) errors.province = 'Tối đa 60 ký tự.';

  if (!form.district.trim()) errors.district = 'Vui lòng nhập quận/huyện và phường/xã.';
  else if (form.district.trim().length > 80) errors.district = 'Tối đa 80 ký tự.';

  const street = form.street.trim();
  if (!street) errors.street = 'Vui lòng nhập địa chỉ chi tiết.';
  else if (street.length < 5)
    errors.street = 'Địa chỉ quá ngắn, vui lòng ghi rõ số nhà, tên đường.';
  else if (street.length > 150) errors.street = 'Tối đa 150 ký tự.';

  if (form.note.trim().length > MAX_NOTE_LENGTH) {
    errors.note = `Ghi chú tối đa ${MAX_NOTE_LENGTH} ký tự.`;
  }
  return errors;
}

export function toShippingInfo(form: CheckoutForm): ShippingInfo {
  const note = form.note.trim();
  return {
    recipientName: form.recipientName.trim(),
    phone: normalizePhone(form.phone),
    address: [form.street, form.district, form.province].map((part) => part.trim()).join(', '),
    ...(note && { note }),
  };
}
