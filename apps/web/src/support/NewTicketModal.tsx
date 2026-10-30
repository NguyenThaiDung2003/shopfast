import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { errorMessage } from '../api/errors';
import { Button, Icon, Input, Modal, Select, Textarea, type SelectOption } from '../components/ui';
import { fetchRecentOrders, orderKeys, type Order } from '../orders/my-orders-api';
import { ORDER_STATUS_META } from '../orders/order-status';
import {
  MAX_MESSAGE_LENGTH,
  MAX_SUBJECT_LENGTH,
  validateNewTicket,
  type NewTicketErrors,
} from './my-tickets-filters';
import type { TicketDetail } from './tickets-api';
import { useCreateTicket } from './useCreateTicket';

const NO_ORDER = '';

function orderLabel(order: Order): string {
  const [first, ...rest] = order.items;
  const items = first ? `${first.name}${rest.length > 0 ? ` +${rest.length}` : ''}` : '';
  return `#${order.code}${items ? ` (${items})` : ''} - ${ORDER_STATUS_META[order.status].label}`;
}

/**
 * "Tạo yêu cầu hỗ trợ mới". Nhóm vấn đề do AI tự phân loại ở nền nên không có ô chọn danh mục.
 * Render khi mở (state form mới cho mỗi lần mở).
 */
export function NewTicketModal({
  defaultOrderId,
  onClose,
  onCreated,
}: {
  /** Đơn chọn sẵn (mở từ trang theo dõi đơn: `/ho-tro?don=<id>`). */
  defaultOrderId?: string;
  onClose: () => void;
  onCreated: (ticket: TicketDetail) => void;
}) {
  const formId = useId();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [orderId, setOrderId] = useState(defaultOrderId ?? NO_ORDER);
  const [errors, setErrors] = useState<NewTicketErrors>({});
  const [serverError, setServerError] = useState<string>();

  const orders = useQuery({
    queryKey: orderKeys.recent,
    queryFn: ({ signal }) => fetchRecentOrders(signal),
  });

  const orderOptions = useMemo<SelectOption[]>(() => {
    const options: SelectOption[] = [
      { value: NO_ORDER, label: 'Không liên quan đến đơn hàng' },
      ...(orders.data?.items ?? []).map((o) => ({ value: o.id, label: orderLabel(o) })),
    ];
    // Đơn chọn sẵn nằm ngoài 50 đơn gần nhất (hoặc danh sách chưa tải xong) vẫn giữ được.
    if (defaultOrderId && !options.some((o) => o.value === defaultOrderId)) {
      options.push({ value: defaultOrderId, label: 'Đơn hàng bạn vừa xem' });
    }
    return options;
  }, [orders.data, defaultOrderId]);

  const create = useCreateTicket({
    onSuccess: onCreated,
    onError: (error) => setServerError(errorMessage(error)),
  });

  const edit = (apply: () => void, field?: keyof NewTicketErrors) => {
    apply();
    create.resetKey();
    setServerError(undefined);
    if (field) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateNewTicket({ subject, message });
    setErrors(found);
    if (found.subject || found.message) return;
    create.submit({
      subject: subject.trim(),
      message: message.trim(),
      orderId: orderId || undefined,
    });
  };

  const ordersHint = orders.isPending
    ? 'Đang tải đơn hàng của bạn…'
    : orders.isError
      ? 'Không tải được danh sách đơn – bạn vẫn có thể gửi yêu cầu.'
      : 'Không bắt buộc';

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!create.isPending}
      size="lg"
      icon="support_agent"
      title="Tạo yêu cầu hỗ trợ mới"
      subtitle="ShopFast CSKH sẽ tiếp nhận và phản hồi sớm nhất"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Huỷ bỏ
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            icon="send"
            loading={create.isPending}
          >
            Gửi yêu cầu hỗ trợ
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-space-md">
        <div className="flex items-start gap-space-md rounded-xl bg-primary-fixed/60 p-space-md">
          <Icon name="auto_awesome" className="mt-0.5 shrink-0 text-2xl text-secondary-container" />
          <div className="space-y-0.5">
            <p className="text-label-md font-bold text-primary">Phân loại tự động (ShopFast AI)</p>
            <p className="text-body-sm text-on-surface-variant">
              Hệ thống tự đọc nội dung yêu cầu, xếp vào đúng nhóm (đơn hàng, vận chuyển, thanh toán,
              đổi trả…) và chuyển tới chuyên viên CSKH phụ trách – bạn không cần chọn danh mục.
            </p>
          </div>
        </div>

        {serverError && (
          <p
            role="alert"
            className="flex items-start gap-space-sm rounded-lg bg-error-container px-space-md py-space-sm text-body-md text-on-error-container"
          >
            <Icon name="error" className="mt-0.5 text-lg" />
            {serverError}
          </p>
        )}

        <Input
          label="Tiêu đề yêu cầu"
          required
          value={subject}
          onChange={(e) => edit(() => setSubject(e.target.value), 'subject')}
          error={errors.subject}
          placeholder="VD: Đổi địa chỉ nhận hàng, thắc mắc khuyến mãi, xuất hoá đơn VAT…"
          hint={`Tối đa ${MAX_SUBJECT_LENGTH} ký tự`}
        />

        <Select
          label="Mã đơn hàng liên quan"
          value={orderId}
          onChange={(e) => edit(() => setOrderId(e.target.value))}
          options={orderOptions}
          hint={ordersHint}
        />

        <Textarea
          label="Nội dung chi tiết"
          required
          rows={5}
          value={message}
          onChange={(e) => edit(() => setMessage(e.target.value), 'message')}
          error={errors.message}
          counterMax={MAX_MESSAGE_LENGTH}
          placeholder="Mô tả cụ thể thắc mắc hoặc sự cố bạn gặp phải. Càng chi tiết thì chuyên viên càng xử lý nhanh…"
        />
      </form>
    </Modal>
  );
}
