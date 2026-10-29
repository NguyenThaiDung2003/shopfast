# infra

Hạ tầng triển khai của ShopFast.

Môi trường **dev** dùng `docker-compose.yml` ở gốc repo (api + postgres:16 + redis:7) – xem [README → Chạy cục bộ](../README.md#chạy-cục-bộ) và [ADR-0002](../docs/adr/0002-mo-hinh-du-lieu-va-moi-truong-dev.md).

Các phần sẽ bổ sung tại đây: compose production (không publish cổng DB/Redis), cấu hình Nginx + HTTPS, script sao lưu DB, cấu hình triển khai EC2.
