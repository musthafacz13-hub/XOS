-- XOS Additive Migration: Simplified Attendance-Based Salary System
-- Safe & backward-compatible: adds day_type on attendance_records, backfills Present rows to 'full_day',
-- preserves all historical attendance records (including legacy 'leave' rows and calculated_salary snapshots),
-- and relaxes legacy working-hour NOT NULL / check constraints on salary_configs.

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS day_type TEXT;

ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_day_type_check;

ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_day_type_check
  CHECK (day_type IS NULL OR day_type IN ('full_day', 'half_day'));

-- Backfill existing Present rows that do not yet have day_type to 'full_day'
UPDATE public.attendance_records
SET day_type = 'full_day'
WHERE LOWER(status) = 'present'
  AND day_type IS NULL;

-- Ensure non-present rows (absent, holiday, legacy leave) keep day_type NULL without altering status or calculated_salary
UPDATE public.attendance_records
SET day_type = NULL
WHERE LOWER(status) <> 'present'
  AND day_type IS NOT NULL;

-- Ensure salary_configs works cleanly with only daily_base_salary + currency_code
ALTER TABLE public.salary_configs
  ALTER COLUMN standard_hours DROP NOT NULL;

ALTER TABLE public.salary_configs
  ALTER COLUMN extra_hour_rate DROP NOT NULL;

ALTER TABLE public.salary_configs
  DROP CONSTRAINT IF EXISTS salary_configs_standard_hours_check;

ALTER TABLE public.salary_configs
  ALTER COLUMN standard_hours SET DEFAULT 8;

ALTER TABLE public.salary_configs
  ALTER COLUMN extra_hour_rate SET DEFAULT 0;
