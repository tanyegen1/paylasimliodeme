-- Payımız çekirdek şeması.
-- Tutarlar: para biriminin en küçük biriminde BIGINT. Zamanlar: timestamptz (UTC saklanır).
-- Bakiye gerçeğinin kaynağı: expenses(+payers, +allocations) ve payments. Bakiyeler saklanmaz, yeniden hesaplanır.

create table users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 60),
  email text,
  password_hash text,
  is_guest boolean not null default true,          -- kimlik bilgisi (e-posta+parola) henüz yok
  is_demo boolean not null default false,
  iban text,
  iban_holder text,
  timezone text not null default 'Europe/Istanbul',
  locale text not null default 'tr',
  terms_accepted_at timestamptz,
  marketing_opt_in boolean not null default false,  -- bildirim izinlerinden ayrı
  marketing_opt_in_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index users_email_uq on users (lower(email)) where email is not null;

create table sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,                  -- çerezdeki belirtecin SHA-256'sı
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions(user_id);

create table notification_prefs (
  user_id uuid primary key references users(id) on delete cascade,
  reminders boolean not null default true,
  payment_updates boolean not null default true,
  group_activity boolean not null default true,
  channel_email boolean not null default false,
  channel_push boolean not null default false
);

create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  type text not null check (type in ('home','trip','meal','event','other')),
  currency text not null default 'TRY',
  simplify_debts boolean not null default true,
  settle_schedule text not null default 'manual' check (settle_schedule in ('weekly','month_end','date','trip_end','manual')),
  settle_date date,
  start_date date,
  end_date date,
  created_by uuid references users(id) on delete set null,
  is_demo boolean not null default false,
  settled_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid references users(id) on delete set null,  -- null: geçici isimle eklenen ya da hesabı silinen kişi
  display_name text not null check (char_length(display_name) between 1 and 60),
  role text not null default 'member' check (role in ('admin','member','guest')),
  status text not null default 'active' check (status in ('active','left')),
  stay_from date,   -- ev grupları için gün bazlı paylaşımda kullanılır
  stay_to date,
  position int not null default 0,
  joined_at timestamptz not null default now(),
  left_at timestamptz
);
create unique index members_group_user_uq on members(group_id, user_id) where user_id is not null;
create index members_group_idx on members(group_id);
create index members_user_idx on members(user_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references members(id) on delete cascade,
  target_member_id uuid references members(id) on delete cascade, -- kişiye özel davet: geçici üyeyi doğrudan bağlar, tek kullanımlık
  max_uses int,
  use_count int not null default 0,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Genel davetle gelen birinin "ben bu geçici üyeyim" talebi; yönetici onayı gerekir.
create table claim_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references members(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index claim_pending_uq on claim_requests(group_id, user_id) where status = 'pending';

create table attachments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  uploader_user_id uuid references users(id) on delete set null,
  kind text not null check (kind in ('receipt','document','proof')),
  mime text not null,
  size_bytes int not null,
  storage_key text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  created_by uuid not null references members(id),
  title text not null,
  status text not null default 'draft' check (status in ('draft','open','finalized')),
  currency text not null default 'TRY',
  payer_member_id uuid not null references members(id),
  expense_date date not null default current_date,
  declared_total_minor bigint,                      -- fişte yazan toplam (OCR veya elle)
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  service_minor bigint not null default 0 check (service_minor >= 0),
  tip_minor bigint not null default 0 check (tip_minor >= 0),
  extras_mode text not null default 'proportional' check (extras_mode in ('proportional','equal')),
  mismatch_ack boolean not null default false,      -- toplam uyuşmazlığı kullanıcı tarafından onaylandı
  attachment_id uuid references attachments(id) on delete set null,
  ocr_provider text,
  expense_id uuid,
  finalized_by uuid references members(id),
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);
create table receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts(id) on delete cascade,
  name text not null,
  quantity numeric(10,3) not null default 1,
  amount_minor bigint not null check (amount_minor >= 0),  -- satır toplamı
  uncertain boolean not null default false,
  position int not null default 0
);
-- Her (kalem, üye) tek satır: eşzamanlı seçimler birbirini ezmez.
create table receipt_claims (
  item_id uuid not null references receipt_items(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  weight int not null default 1 check (weight between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (item_id, member_id)
);

create table recurring_rules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  title text not null,
  category text not null default 'other',
  amount_minor bigint check (amount_minor > 0),     -- null: değişken fatura, tutar bekleyen taslak üretir
  currency text not null default 'TRY',
  payer_member_id uuid not null references members(id),
  frequency text not null check (frequency in ('monthly','weekly')),
  day_of_month int check (day_of_month between 1 and 31),
  next_run date not null,
  prorate_by_days boolean not null default false,
  active boolean not null default true,
  created_by uuid not null references members(id),
  created_at timestamptz not null default now()
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  note text,
  category text not null default 'other',
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null,
  -- Kur çevrimi yapıldıysa özgün tutar ve kullanıcının onayladığı kur:
  original_amount_minor bigint,
  original_currency text,
  fx_rate numeric(18,6),
  fx_source text,
  fx_date date,
  expense_date date not null,
  split_type text not null check (split_type in ('equal','exact','percent','shares','itemized')),
  split_meta jsonb not null default '{}',            -- girilen yüzdeler/paylar/kalemler: açıklanabilirlik için
  status text not null default 'active' check (status in ('active','draft')),  -- draft: tutar bekliyor, bakiyeye girmez
  created_by uuid references members(id),
  receipt_id uuid references receipts(id) on delete set null,
  recurring_rule_id uuid references recurring_rules(id) on delete set null,
  period_start date,
  period_end date,
  attachment_id uuid references attachments(id) on delete set null,
  version int not null default 1,
  deleted_at timestamptz,
  deleted_by uuid references members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_group_idx on expenses(group_id, expense_date desc);

create table expense_payers (
  expense_id uuid not null references expenses(id) on delete cascade,
  member_id uuid not null references members(id),
  amount_minor bigint not null check (amount_minor >= 0),
  primary key (expense_id, member_id)
);
create table expense_allocations (
  expense_id uuid not null references expenses(id) on delete cascade,
  member_id uuid not null references members(id),
  amount_minor bigint not null check (amount_minor >= 0),
  rounding_minor int not null default 0,             -- bu kişiye düşen yuvarlama kuruşu
  primary key (expense_id, member_id)
);

-- Zamanlanmış görev aynı dönemi iki kez üretemez.
create table recurring_runs (
  rule_id uuid not null references recurring_rules(id) on delete cascade,
  period_key text not null,
  expense_id uuid references expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (rule_id, period_key)
);

create table expense_comments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id) on delete cascade,
  member_id uuid not null references members(id),
  kind text not null default 'comment' check (kind in ('comment','correction_request')),
  body text not null check (char_length(body) between 1 and 1000),
  status text not null default 'open' check (status in ('open','resolved')),
  resolved_by uuid references members(id),
  created_at timestamptz not null default now()
);

-- ÖDEME: talep (plan) / girişim (sağlayıcı) / beyan (manuel) / kesinleşmiş ödeme (defter) ayrı tutulur.
create table payment_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  from_member uuid not null references members(id),  -- borçlu
  to_member uuid not null references members(id),    -- alacaklı
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  status text not null default 'pending' check (status in ('draft','pending','processing','verified','failed','cancelled','expired')),
  token_hash text not null unique,                   -- kişiye özel ödeme bağlantısı; katılım yetkisi vermez
  note text,
  expires_at timestamptz not null,
  proposed_date date,                                -- borçlunun önerdiği ödeme tarihi
  proposal_status text check (proposal_status in ('pending','accepted','declined')),
  created_by uuid references members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_member <> to_member)
);
create index payment_requests_group_idx on payment_requests(group_id);

create table payment_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references payment_requests(id) on delete cascade,
  provider text not null,
  provider_ref text not null,
  amount_minor bigint not null check (amount_minor > 0),
  fee_minor bigint not null default 0,
  status text not null default 'initiated' check (status in ('initiated','processing','succeeded','failed','cancelled','reversed')),
  idempotency_key text not null unique,
  last_event_at timestamptz,                         -- sırası bozuk webhook'ları ayıklamak için
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
-- Bir talep için aynı anda tek açık girişim: çifte tahsilat engeli.
create unique index payment_attempts_one_open on payment_attempts(request_id) where status in ('initiated','processing');

create table manual_payment_reports (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  request_id uuid references payment_requests(id) on delete set null,
  from_member uuid not null references members(id),
  to_member uuid not null references members(id),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  status text not null default 'reported' check (status in ('reported','confirmed','rejected')),
  note text,
  attachment_id uuid references attachments(id) on delete set null,  -- dekont: tek başına kanıt sayılmaz
  reported_by_user uuid references users(id) on delete set null,
  reported_via text not null default 'app' check (reported_via in ('app','pay_link')),
  decided_by uuid references members(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- Kesinleşmiş ödemeler: bakiyeyi yalnızca bu tablo değiştirir.
create table payments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  from_member uuid not null references members(id),
  to_member uuid not null references members(id),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  source text not null check (source in ('provider','manual')),
  attempt_id uuid unique references payment_attempts(id),        -- aynı girişim iki kez işlenemez
  report_id uuid unique references manual_payment_reports(id),   -- aynı beyan iki kez işlenemez
  request_id uuid references payment_requests(id) on delete set null,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now(),
  check ((source = 'provider' and attempt_id is not null) or (source = 'manual' and report_id is not null))
);
create index payments_group_idx on payments(group_id);

create table webhook_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table couple_links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  member_a uuid not null references members(id) on delete cascade,  -- öneren; temsilci
  member_b uuid not null references members(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','ended')),
  created_at timestamptz not null default now(),
  check (member_a <> member_b)
);

create table audit_events (
  id bigserial primary key,
  group_id uuid references groups(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  actor_member_id uuid references members(id) on delete set null,
  type text not null,
  entity_type text,
  entity_id uuid,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_group_idx on audit_events(group_id, id desc);
create index audit_entity_idx on audit_events(entity_id);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  group_id uuid references groups(id) on delete cascade,
  type text not null,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, created_at desc);

create table reminder_log (
  id bigserial primary key,
  group_id uuid not null references groups(id) on delete cascade,
  debtor_member uuid not null references members(id) on delete cascade,
  creditor_member uuid not null references members(id) on delete cascade,
  kind text not null check (kind in ('auto','manual')),
  period_key text,
  created_at timestamptz not null default now()
);
create unique index reminder_auto_uq on reminder_log(group_id, debtor_member, creditor_member, period_key) where kind = 'auto';

create table entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  plan text not null check (plan in ('premium')),
  source text not null,                              -- 'manual_grant' | 'demo' | ileride abonelik sağlayıcısı
  valid_until timestamptz,
  created_at timestamptz not null default now()
);
create table usage_counters (
  user_id uuid not null references users(id) on delete cascade,
  feature text not null,
  period text not null,                              -- YYYY-AA
  count int not null default 0,
  primary key (user_id, feature, period)
);

-- Analitik: kişisel veri içermez (isim, IBAN, açıklama, fiş içeriği yazılmaz).
create table analytics_events (
  id bigserial primary key,
  name text not null,
  actor_hash text,
  group_hash text,
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index analytics_name_idx on analytics_events(name, created_at);

create table data_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  kind text not null check (kind in ('export','delete')),
  created_at timestamptz not null default now()
);
