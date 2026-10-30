export class QueueStatsDto {
  /** Tên queue: email, invoice, inventory-sync, dead-letter. */
  name!: string;
  /** Đang chờ xử lý. */
  waiting!: number;
  /** Đang chạy. */
  active!: number;
  /** Hẹn giờ (delayed) hoặc chờ thử lại sau backoff. */
  delayed!: number;
  /** Hoàn tất (còn được lưu trong Redis). */
  completed!: number;
  /** Thất bại hẳn (hết lượt thử). */
  failed!: number;
}

export class QueuesStatsDto {
  /** Số job theo trạng thái của từng queue. */
  queues!: QueueStatsDto[];
}
