CREATE TABLE IF NOT EXISTS approved_emails (
  email      citext      PRIMARY KEY,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
