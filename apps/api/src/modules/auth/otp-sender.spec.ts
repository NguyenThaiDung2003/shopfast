import { MailMessage, MailSender } from '../mail/mail-sender';
import { OtpPurpose } from './dto/send-otp.dto';
import { MailOtpSender } from './otp-sender';

describe('MailOtpSender', () => {
  const sent: MailMessage[] = [];
  const mail: MailSender = { send: async (message) => void sent.push(message) };
  const message = { email: 'khach@shopfast.local', code: '123456', expiresInSeconds: 300 };

  beforeEach(() => {
    sent.length = 0;
  });

  it('gửi mã trong nội dung, không đưa mã lên tiêu đề', async () => {
    await new MailOtpSender(mail).send({ ...message, purpose: OtpPurpose.VERIFY_EMAIL });

    expect(sent[0]).toMatchObject({ to: message.email, subject: 'Mã xác minh email ShopFast' });
    expect(sent[0]!.text).toContain('123456');
    expect(sent[0]!.text).toContain('5 phút');
    expect(sent[0]!.subject).not.toContain('123456');
  });

  it('mỗi thư có Message-ID riêng và tiêu đề theo mục đích', async () => {
    const sender = new MailOtpSender(mail);
    await sender.send({ ...message, purpose: OtpPurpose.RESET_PASSWORD });
    await sender.send({ ...message, purpose: OtpPurpose.RESET_PASSWORD });

    expect(sent[0]!.subject).toBe('Mã đặt lại mật khẩu ShopFast');
    expect(sent[0]!.messageId).not.toBe(sent[1]!.messageId);
  });
});
