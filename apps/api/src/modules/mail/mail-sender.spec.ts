import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { EnvironmentVariables } from '../../config/env.validation';
import { SmtpMailSender } from './mail-sender';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const message = {
  to: 'customer13@shopfast.local',
  subject: 'Xác nhận đơn SF-000123',
  text: 'Nội dung',
  messageId: '<order-confirmation.1@shopfast.local>',
};

function setup(redirectTo?: string) {
  const sendMail = jest.fn().mockResolvedValue(undefined);
  (createTransport as jest.Mock).mockReturnValue({ sendMail });
  const values: Record<string, unknown> = {
    MAIL_FROM: 'ShopFast <shop@example.com>',
    MAIL_REDIRECT_TO: redirectTo,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<
    EnvironmentVariables,
    true
  >;
  return { sender: new SmtpMailSender(config), sendMail };
}

describe('SmtpMailSender', () => {
  it('không đặt MAIL_REDIRECT_TO → gửi đúng người nhận', async () => {
    const { sender, sendMail } = setup();

    await sender.send(message);

    expect(sendMail).toHaveBeenCalledWith({ from: 'ShopFast <shop@example.com>', ...message });
  });

  it('có MAIL_REDIRECT_TO → gửi về địa chỉ đó, tiêu đề ghi người nhận gốc', async () => {
    const { sender, sendMail } = setup('demo@example.com');

    await sender.send(message);

    expect(sendMail).toHaveBeenCalledWith({
      from: 'ShopFast <shop@example.com>',
      to: 'demo@example.com',
      subject: '[Gửi cho: customer13@shopfast.local] Xác nhận đơn SF-000123',
      text: 'Nội dung',
      messageId: message.messageId,
    });
  });
});
