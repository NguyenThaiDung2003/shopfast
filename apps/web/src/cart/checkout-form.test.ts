import { describe, expect, it } from 'vitest';
import { toShippingInfo, validateCheckout, type CheckoutForm } from './checkout-form';

const FORM: CheckoutForm = {
  recipientName: ' Nguyễn Văn Minh ',
  phone: '0912 345 678',
  province: 'TP. Hồ Chí Minh',
  district: 'Quận 1, Phường Bến Nghé',
  street: '123 Lê Lợi',
  note: '',
};

describe('validateCheckout', () => {
  it('hợp lệ → không lỗi', () => {
    expect(validateCheckout(FORM)).toEqual({});
  });

  it.each([
    ['0912345678', true],
    ['0912.345.678', true],
    ['+84912345678', true],
    ['12345', false],
    ['09123456789', false],
    ['abc', false],
  ])('SĐT %s → hợp lệ: %s', (phone, ok) => {
    expect(validateCheckout({ ...FORM, phone }).phone === undefined).toBe(ok);
  });

  it('thiếu và quá dài', () => {
    expect(validateCheckout({ ...FORM, recipientName: ' ', street: '' })).toEqual({
      recipientName: 'Vui lòng nhập họ tên người nhận.',
      street: 'Vui lòng nhập địa chỉ chi tiết.',
    });
    expect(validateCheckout({ ...FORM, recipientName: 'A' }).recipientName).toBe(
      'Họ tên từ 2 đến 100 ký tự.',
    );
    expect(validateCheckout({ ...FORM, street: 'abc' }).street).toContain('quá ngắn');
    expect(validateCheckout({ ...FORM, note: 'a'.repeat(501) }).note).toBe(
      'Ghi chú tối đa 500 ký tự.',
    );
  });
});

describe('toShippingInfo', () => {
  it('ghép địa chỉ, chuẩn hoá SĐT, bỏ ghi chú rỗng', () => {
    expect(toShippingInfo(FORM)).toEqual({
      recipientName: 'Nguyễn Văn Minh',
      phone: '0912345678',
      address: '123 Lê Lợi, Quận 1, Phường Bến Nghé, TP. Hồ Chí Minh',
    });
    expect(toShippingInfo({ ...FORM, note: ' Gọi trước ' }).note).toBe('Gọi trước');
  });

  it('độ dài tối đa từng phần vẫn nằm trong giới hạn 300 ký tự của API', () => {
    const { address } = toShippingInfo({
      ...FORM,
      province: 'a'.repeat(60),
      district: 'b'.repeat(80),
      street: 'c'.repeat(150),
    });
    expect(address.length).toBeLessThanOrEqual(300);
  });
});
