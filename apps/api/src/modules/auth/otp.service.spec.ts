import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { OtpPurpose } from './dto/send-otp.dto';
import { OtpSender } from './otp-sender';
import { OtpRepository } from './otp.repository';
import { OtpService } from './otp.service';

const email = 'customer01@shopfast.local';
const purpose = OtpPurpose.VERIFY_EMAIL;
const key = `otp:${purpose}:${email}`;
const sha256 = (code: string) => createHash('sha256').update(code).digest('hex');

describe('OtpService', () => {
  let repository: jest.Mocked<
    Pick<OtpRepository, 'save' | 'find' | 'incrementAttempts' | 'delete'>
  >;
  let sender: jest.Mocked<OtpSender>;
  let service: OtpService;

  beforeEach(() => {
    repository = {
      save: jest.fn().mockResolvedValue(undefined),
      find: jest.fn(),
      incrementAttempts: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    sender = { send: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: (k: string) => ({ OTP_TTL_SECONDS: 300, OTP_MAX_ATTEMPTS: 3 })[k],
    } as unknown as ConfigService<EnvironmentVariables, true>;
    service = new OtpService(repository as unknown as OtpRepository, sender, config);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  it('gửi mã 6 chữ số, chỉ lưu hash kèm TTL', async () => {
    const result = await service.send({ email, purpose });

    const { code } = sender.send.mock.calls[0]![0];
    expect(code).toMatch(/^\d{6}$/);
    expect(repository.save).toHaveBeenCalledWith(key, sha256(code), 300);
    expect(result).toEqual({ expiresInSeconds: 300 });
  });

  it('đúng mã → xác thực thành công và xoá mã (dùng một lần)', async () => {
    repository.find.mockResolvedValue({ codeHash: sha256('123456'), attempts: 0 });

    await expect(service.verify({ email, purpose, code: '123456' })).resolves.toEqual({
      verified: true,
    });
    expect(repository.delete).toHaveBeenCalledWith(key);
  });

  it('không có mã (hết hạn) → OTP_INVALID', async () => {
    repository.find.mockResolvedValue(null);

    await expect(service.verify({ email, purpose, code: '123456' })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
  });

  it('sai mã → tăng số lần sai, trả OTP_INVALID', async () => {
    repository.find.mockResolvedValue({ codeHash: sha256('123456'), attempts: 0 });
    repository.incrementAttempts.mockResolvedValue(1);

    await expect(service.verify({ email, purpose, code: '000000' })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
    expect(repository.incrementAttempts).toHaveBeenCalledWith(key);
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('sai tới lần cuối → 429 và xoá mã', async () => {
    repository.find.mockResolvedValue({ codeHash: sha256('123456'), attempts: 2 });
    repository.incrementAttempts.mockResolvedValue(3);

    await expect(service.verify({ email, purpose, code: '000000' })).rejects.toMatchObject({
      code: 'OTP_TOO_MANY_ATTEMPTS',
    });
    expect(repository.delete).toHaveBeenCalledWith(key);
  });

  it('đã hết lượt thì kể cả đúng mã cũng bị từ chối', async () => {
    repository.find.mockResolvedValue({ codeHash: sha256('123456'), attempts: 3 });

    await expect(service.verify({ email, purpose, code: '123456' })).rejects.toMatchObject({
      code: 'OTP_TOO_MANY_ATTEMPTS',
    });
  });

  it('Redis lỗi → 503 SERVICE_UNAVAILABLE, không gửi mã', async () => {
    repository.save.mockRejectedValue(new Error('Connection is closed.'));

    await expect(service.send({ email, purpose })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(sender.send).not.toHaveBeenCalled();
  });
});
