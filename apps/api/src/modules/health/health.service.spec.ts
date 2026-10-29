import { HealthService } from './health.service';

describe('HealthService', () => {
  const service = new HealthService();

  it('trả trạng thái ok kèm thời gian hoạt động', () => {
    const result = service.check();

    expect(result.status).toBe('ok');
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });
});
