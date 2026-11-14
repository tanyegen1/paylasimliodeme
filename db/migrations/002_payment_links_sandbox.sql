-- Ödeme bağlantısı belirteci sunucuda HMAC(APP_SECRET, id + nonce) ile türetilir:
-- yetkili üyeye yeniden gösterilebilir, nonce değişince eski bağlantı geçersiz olur.
alter table payment_requests add column link_nonce text not null default replace(gen_random_uuid()::text, '-', '');

alter table payment_attempts add column redirect_url text;

-- DEMO ödeme simülatörünün "sağlayıcı tarafı" durumu. Gerçek para hareketi içermez.
create table sandbox_payments (
  ref text primary key,
  amount_minor bigint not null,
  currency text not null,
  status text not null default 'initiated',
  idempotency_key text not null unique,
  updated_at timestamptz not null default now()
);
