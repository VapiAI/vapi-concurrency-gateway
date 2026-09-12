CREATE TABLE IF NOT EXISTS tenants (
  id             TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  cap            INTEGER NOT NULL CHECK (cap >= 0),
  reject_message TEXT NOT NULL,
  voice_id       TEXT NOT NULL DEFAULT 'Elliot',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_phone_numbers (
  phone_number_id TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number          TEXT
);

CREATE TABLE IF NOT EXISTS tenant_assistants (
  assistant_id TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);

-- `pending` is only the short outbound gap before Vapi returns a call id.
-- Both pending and reserved rows consume a tenant line.
CREATE TABLE IF NOT EXISTS reservations (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       TEXT,
  state           TEXT NOT NULL CHECK (state IN ('pending', 'reserved', 'released')),
  call_id         TEXT,
  correlation_id  TEXT,
  direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  reserved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at     TIMESTAMPTZ,
  release_cause   TEXT,
  CONSTRAINT active_requires_tenant CHECK (state = 'released' OR tenant_id IS NOT NULL),
  CONSTRAINT pending_has_correlation CHECK (state <> 'pending' OR correlation_id IS NOT NULL),
  CONSTRAINT reserved_has_call CHECK (state <> 'reserved' OR call_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS reservations_call_id_key
  ON reservations (call_id) WHERE call_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reservations_correlation_id_key
  ON reservations (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservations_active_by_tenant
  ON reservations (tenant_id) WHERE state IN ('pending', 'reserved');

-- A small dashboard log, not an operational event system.
CREATE TABLE IF NOT EXISTS events (
  id             BIGSERIAL PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind           TEXT NOT NULL,
  tenant_id      TEXT,
  call_id        TEXT,
  correlation_id TEXT,
  detail         JSONB NOT NULL DEFAULT '{}'::jsonb
);
