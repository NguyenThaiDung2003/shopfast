import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { CapturingOtpSender, createTestApp } from './create-test-app';

const PASSWORD = 'MatKhau123';
const CUSTOMER = { email: 'khach.e2e@shopfast.local', password: PASSWORD, fullName: 'Khách E2E' };
const ADMIN_EMAIL = 'admin.e2e@shopfast.local';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let otpSender: CapturingOtpSender;
  let http: ReturnType<typeof request>;

  const login = (email: string, password: string) =>
    http.post('/api/auth/login').send({ email, password });

  beforeAll(async () => {
    ({ app, otpSender } = await createTestApp());
    http = request(app.getHttpServer());

    // Không có API tạo admin (đúng thiết kế) nên tạo thẳng trong DB test.
    await app.get(PrismaService).user.create({
      data: {
        email: ADMIN_EMAIL,
        fullName: 'Quản trị E2E',
        role: Role.ADMIN,
        passwordHash: await hash(PASSWORD, 4),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('đăng ký', () => {
    it('201: tạo CUSTOMER và trả cặp token, không lộ passwordHash', async () => {
      const res = await http
        .post('/api/auth/register')
        .send({ ...CUSTOMER, email: '  Khach.E2E@ShopFast.local ', role: Role.ADMIN })
        .expect(201);

      expect(res.body.user).toMatchObject({ email: CUSTOMER.email, role: Role.CUSTOMER });
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toEqual(expect.any(String));
    });

    it('409: email đã tồn tại', async () => {
      const res = await http.post('/api/auth/register').send(CUSTOMER).expect(409);

      expect(res.body).toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });
    });

    it('400: mật khẩu yếu', async () => {
      const res = await http
        .post('/api/auth/register')
        .send({ ...CUSTOMER, email: 'yeu@shopfast.local', password: 'abc' })
        .expect(400);

      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('đăng nhập', () => {
    it('200: đúng mật khẩu', async () => {
      const res = await login(CUSTOMER.email, PASSWORD).expect(200);

      expect(res.body.user.email).toBe(CUSTOMER.email);
    });

    it('401: sai mật khẩu', async () => {
      const res = await login(CUSTOMER.email, 'SaiMatKhau9').expect(401);

      expect(res.body).toMatchObject({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu không đúng.',
      });
    });

    it('401: email không tồn tại trả đúng cùng thông điệp (không dò được email)', async () => {
      const wrongPassword = await login(CUSTOMER.email, 'SaiMatKhau9');
      const unknownEmail = await login('khongtontai@shopfast.local', 'SaiMatKhau9');

      expect(unknownEmail.status).toBe(401);
      expect(unknownEmail.body.code).toBe(wrongPassword.body.code);
      expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
    });
  });

  describe('access token', () => {
    it('200: /auth/me với token hợp lệ', async () => {
      const { body } = await login(CUSTOMER.email, PASSWORD);

      const res = await http
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ email: CUSTOMER.email, role: Role.CUSTOMER });
    });

    it('401 TOKEN_EXPIRED: token hết hạn', async () => {
      const { body } = await login(CUSTOMER.email, PASSWORD);
      const expired = await app
        .get(JwtService)
        .signAsync({ sub: body.user.id, role: Role.CUSTOMER }, { expiresIn: -60 });

      const res = await http
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);

      expect(res.body).toMatchObject({
        code: 'TOKEN_EXPIRED',
        message: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
      });
    });

    it('401 UNAUTHENTICATED: không có token hoặc token giả', async () => {
      await http.get('/api/auth/me').expect(401);
      const res = await http
        .get('/api/auth/me')
        .set('Authorization', 'Bearer khong.phai.jwt')
        .expect(401);

      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('endpoint @Public vẫn truy cập được không cần token', async () => {
      await http.get('/api/products?limit=1').expect(200);
      await http.get('/api/health').expect(200);
    });
  });

  describe('phân quyền (RBAC)', () => {
    it('403 FORBIDDEN_ROLE: customer gọi endpoint chỉ dành cho admin', async () => {
      const { body } = await login(CUSTOMER.email, PASSWORD);

      const res = await http
        .get('/api/users')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(403);

      expect(res.body).toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN_ROLE',
        message: 'Bạn không có quyền thực hiện thao tác này.',
      });
    });

    it('200: admin xem được danh sách user, không có passwordHash', async () => {
      const { body } = await login(ADMIN_EMAIL, PASSWORD);

      const res = await http
        .get('/api/users?role=CUSTOMER')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);

      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
      expect(res.body.items[0]).not.toHaveProperty('passwordHash');
      expect(res.body.items.every((u: { role: Role }) => u.role === Role.CUSTOMER)).toBe(true);
    });
  });

  describe('refresh token', () => {
    it('xoay vòng: token cũ hết dùng được, token mới dùng được', async () => {
      const { body: first } = await login(CUSTOMER.email, PASSWORD);

      const { body: second } = await http
        .post('/api/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      await http
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${second.accessToken}`)
        .expect(200);
    });

    it('dùng lại refresh token cũ → 401 và cả phiên (family) bị thu hồi', async () => {
      const { body: first } = await login(CUSTOMER.email, PASSWORD);
      const { body: second } = await http
        .post('/api/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);

      const reuse = await http
        .post('/api/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      expect(reuse.body.code).toBe('REFRESH_TOKEN_REUSED');

      // Token hợp lệ mới nhất của phiên cũng không còn dùng được.
      const afterReuse = await http
        .post('/api/auth/refresh')
        .send({ refreshToken: second.refreshToken })
        .expect(401);
      expect(afterReuse.body.code).toBe('REFRESH_TOKEN_REUSED');
    });

    it('đăng xuất → refresh token bị thu hồi; phiên khác không ảnh hưởng', async () => {
      const { body: phone } = await login(CUSTOMER.email, PASSWORD);
      const { body: laptop } = await login(CUSTOMER.email, PASSWORD);

      await http.post('/api/auth/logout').send({ refreshToken: phone.refreshToken }).expect(204);

      await http.post('/api/auth/refresh').send({ refreshToken: phone.refreshToken }).expect(401);
      await http.post('/api/auth/refresh').send({ refreshToken: laptop.refreshToken }).expect(200);
    });

    it('logout-all thu hồi mọi phiên của user', async () => {
      const { body: a } = await login(CUSTOMER.email, PASSWORD);
      const { body: b } = await login(CUSTOMER.email, PASSWORD);

      await http
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(204);

      await http.post('/api/auth/refresh').send({ refreshToken: a.refreshToken }).expect(401);
      await http.post('/api/auth/refresh').send({ refreshToken: b.refreshToken }).expect(401);
    });

    it('401: refresh token không tồn tại', async () => {
      const res = await http
        .post('/api/auth/refresh')
        .send({ refreshToken: 'token-bia-dat' })
        .expect(401);

      expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  describe('OTP', () => {
    const otpRequest = { email: CUSTOMER.email, purpose: 'VERIFY_EMAIL' };

    it('202 gửi mã → 400 sai mã → 200 đúng mã → mã không dùng lại được', async () => {
      const sent = await http.post('/api/auth/otp/send').send(otpRequest).expect(202);
      expect(sent.body).toEqual({ expiresInSeconds: 300 });

      const code = otpSender.lastCodeFor(CUSTOMER.email);
      expect(code).toMatch(/^\d{6}$/);
      const wrong = code === '000000' ? '111111' : '000000';

      const bad = await http
        .post('/api/auth/otp/verify')
        .send({ ...otpRequest, code: wrong })
        .expect(400);
      expect(bad.body.code).toBe('OTP_INVALID');

      await http
        .post('/api/auth/otp/verify')
        .send({ ...otpRequest, code })
        .expect(200, { verified: true });

      await http
        .post('/api/auth/otp/verify')
        .send({ ...otpRequest, code })
        .expect(400);
    });
  });
});
