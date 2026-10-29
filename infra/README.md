# infra

Hạ tầng triển khai của ShopFast.

Môi trường **dev** dùng `docker-compose.yml` ở gốc repo (api + postgres:16 + redis:7) – xem [README → Chạy cục bộ](../README.md#chạy-cục-bộ) và [ADR-0002](../docs/adr/0002-mo-hinh-du-lieu-va-moi-truong-dev.md).

- [nginx/api.conf](nginx/api.conf) – khối `location /api/` chuyển tiếp IP thật cho rate limit; API phải chạy với `TRUST_PROXY=1` khi đứng sau Nginx ([ADR-0008](../docs/adr/0008-rate-limit-va-khoa-dang-nhap.md)).

Các phần sẽ bổ sung tại đây: compose production (không publish cổng DB/Redis), cấu hình Nginx + HTTPS, script sao lưu DB, cấu hình triển khai EC2.
