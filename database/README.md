# Database Setup Guide (Neon)

This project uses Neon as the managed PostgreSQL provider.

## Initialize the Database

Apply `schema.sql` to your Neon database.

### Method 1: Neon SQL Editor (Recommended)

1. Open your Neon project.
2. Open SQL Editor.
3. Paste contents of `schema.sql`.
4. Execute.

### Method 2: `psql`

```bash
psql "postgresql://USER:PASSWORD@HOST/DB?sslmode=require" -f schema.sql
```

## Verify Installation

```sql
-- List tables
\dt

-- Check starter keywords
SELECT COUNT(*) FROM blocked_keywords;

-- Check config
SELECT * FROM config;

-- View summary
SELECT * FROM filter_summary;
```

Expected results:
- 4 tables: `blocked_keywords`, `blocked_channels`, `allowed_channels`, `config`
- ~25 starter blocked keywords
- 3 config entries

## Connection String

Use your Neon connection string as `DATABASE_URL` in Koyeb:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
```

## Backup / Restore

Use Neon backup/branching features where possible. You can also export/import with `pg_dump` and `psql`.

### Backup

```bash
pg_dump "postgresql://USER:PASSWORD@HOST/DB?sslmode=require" > ytk2_backup.sql
```

### Restore

```bash
psql "postgresql://USER:PASSWORD@HOST/DB?sslmode=require" < ytk2_backup.sql
```
