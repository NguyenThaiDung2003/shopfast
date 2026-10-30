import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { errorMessage, isApiError } from '../api/errors';
import { Button, Icon, Modal, OrderStatusBadge, Textarea, useToast } from '../components/ui';
import { orderKeys } from '../orders/my-orders-api';
import { ORDER_STATUS_META } from '../orders/order-status';
import { MAX_NOTE_LENGTH, validateStatusNote } from './orders-filters';
import type { TransitionAction } from './transition-view';
import { changeOrderStatus, warehouseKeys, type StaffOrder } from './warehouse-api';

/** "Xác nhận chuyển trạng thái" – PATCH /orders/:id/status sau khi nhân viên xác nhận. */
export function TransitionModal({
  order,
  action,
  onClose,
}: {
  order: StaffOrder;
  action: TransitionAction;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const cancelling = action.kind === 'cancel';
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: warehouseKeys.ordersAll });
    void queryClient.invalidateQueries({ queryKey: orderKeys.detail(order.id) });
  };

  const change = useMutation({
    mutationFn: () => changeOrderStatus(order.id, action.to, note.trim() || undefined),
    onSuccess: (updated) => {
      refresh();
      onClose();
      toast.show({
        tone: 'success',
        title: 'Cập nhật thành công',
        description: `Đơn #${updated.code} đã chuyển sang ${ORDER_STATUS_META[updated.status].label}.`,
      });
    },
    onError: (err) => {
      toast.show({
        tone: 'error',
        title:
          isApiError(err) && err.code === 'INVALID_STATUS_TRANSITION'
            ? 'Chuyển trạng thái không hợp lệ'
            : 'Không cập nhật được đơn',
        description: errorMessage(err),
      });
      // Đơn đã bị người khác đổi / không còn → tải lại và đóng; lỗi tạm thời giữ để thử lại.
      if (isApiError(err) && (err.status === 409 || err.status === 404)) {
        refresh();
        onClose();
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const invalid = validateStatusNote(action.to, note);
    setError(invalid);
    if (!invalid) change.mutate();
  };

  const formId = `transition-${order.id}`;
  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!change.isPending}
      icon={cancelling ? 'cancel' : 'swap_horiz'}
      title={cancelling ? 'Xác nhận huỷ đơn' : 'Xác nhận chuyển trạng thái'}
      subtitle="Thao tác được ghi vào lịch sử đơn và thông báo cho khách"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={change.isPending}>
            Huỷ bỏ
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={cancelling ? 'danger' : 'primary'}
            icon="check"
            loading={change.isPending}
          >
            {cancelling ? 'Xác nhận huỷ đơn' : 'Xác nhận chuyển'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-space-md">
        <p className="text-body-lg text-on-surface">
          Bạn có chắc chắn muốn chuyển đơn hàng{' '}
          <strong className="text-primary">#{order.code}</strong>
          {order.customer && (
            <>
              {' '}
              (Khách hàng: <strong>{order.customer.fullName}</strong> • {itemCount} sản phẩm)
            </>
          )}{' '}
          từ trạng thái <OrderStatusBadge status={order.status} size="sm" withIcon={false} /> sang{' '}
          <OrderStatusBadge status={action.to} size="sm" withIcon={false} /> không?
        </p>
        {cancelling && (
          <p className="flex items-start gap-space-sm rounded-lg bg-secondary-fixed/50 px-space-md py-space-sm text-body-md text-on-secondary-fixed-variant">
            <Icon name="info" className="mt-0.5 text-lg" />
            Huỷ đơn sẽ hoàn lại tồn kho các sản phẩm trong đơn và không thể khôi phục.
          </p>
        )}
        <Textarea
          label={cancelling ? 'Lý do huỷ đơn' : 'Ghi chú (không bắt buộc)'}
          required={cancelling}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError(undefined);
          }}
          error={error}
          counterMax={MAX_NOTE_LENGTH}
          rows={3}
          placeholder={
            cancelling
              ? 'Ví dụ: Khách yêu cầu huỷ do đặt nhầm màu'
              : 'Ví dụ: mã vận đơn, mã kiện, người bàn giao…'
          }
        />
      </form>
    </Modal>
  );
}
