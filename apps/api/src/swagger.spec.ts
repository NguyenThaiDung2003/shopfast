import type { OpenAPIObject } from '@nestjs/swagger';
import { splitSummaries } from './swagger';

function doc(description?: string, summary?: string): OpenAPIObject {
  return {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths: { '/x': { patch: { description, summary, responses: {} } } },
  };
}

describe('splitSummaries', () => {
  it('đoạn đầu của JSDoc thành summary, phần còn lại giữ làm description', () => {
    const op = splitSummaries(
      doc('Cập nhật trạng thái đơn (kho)\n\nPENDING_PAYMENT → PAID; sai bước\n→ 409.'),
    ).paths['/x']!.patch!;

    expect(op.summary).toBe('Cập nhật trạng thái đơn (kho)');
    expect(op.description).toBe('PENDING_PAYMENT → PAID; sai bước → 409.');
  });

  it('JSDoc một dòng → chỉ có summary', () => {
    const op = splitSummaries(doc('Giỏ hàng của tôi')).paths['/x']!.patch!;

    expect(op).toMatchObject({ summary: 'Giỏ hàng của tôi', description: undefined });
  });

  it('không đè summary đã khai báo, bỏ qua operation không có mô tả', () => {
    expect(splitSummaries(doc('Mô tả', 'Có sẵn')).paths['/x']!.patch!.summary).toBe('Có sẵn');
    expect(splitSummaries(doc()).paths['/x']!.patch!.summary).toBeUndefined();
  });
});
