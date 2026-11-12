-- ============================================================================
-- Migration: 20261111_xos_initial_schema.sql
-- Description: Complete production schema for XOS (10 Sections)
-- Target: Supabase (PostgreSQL with RLS & auth.users integration)
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 2. USER PROFILES & SETTINGS
-- ============================================================================

-- 2.1 Profiles (1:1 with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  occupation TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.2 User Settings
CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  date_format VARCHAR(20) NOT NULL DEFAULT 'YYYY-MM-DD',
  week_start_day VARCHAR(10) NOT NULL DEFAULT 'Monday',
  custom_expense_categories TEXT[] NOT NULL DEFAULT ARRAY[
    'Food & Dining', 'Housing', 'Utilities', 'Transport', 
    'Entertainment', 'Shopping', 'Health & Fitness', 'Education', 
    'Debt & Bills', 'Other'
  ],
  custom_income_sources TEXT[] NOT NULL DEFAULT ARRAY[
    'Salary', 'Freelance', 'Business', 'Gifts', 'Investments', 'Other'
  ],
  widgets_config JSONB NOT NULL DEFAULT '[
    {"id": "balance_overview", "name": "Balance & Cash Flow Overview", "visible": true, "order": 1},
    {"id": "work_attendance", "name": "Work & Salary Summary", "visible": true, "order": 2},
    {"id": "active_goals", "name": "Active Goals & Dreams", "visible": true, "order": 3},
    {"id": "recent_activity", "name": "Recent Financial Activity", "visible": true, "order": 4},
    {"id": "quick_actions", "name": "Quick Logging Actions", "visible": true, "order": 5}
  ]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.3 Salary Configuration
CREATE TABLE IF NOT EXISTS public.salary_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  salary_type VARCHAR(30) NOT NULL DEFAULT 'daily_wage',
  daily_base_salary NUMERIC(12, 2) NOT NULL DEFAULT 500.00 CHECK (daily_base_salary >= 0),
  standard_working_hours NUMERIC(4, 2) NOT NULL DEFAULT 8.00 CHECK (standard_working_hours > 0),
  extra_hour_rate NUMERIC(12, 2) NOT NULL DEFAULT 100.00 CHECK (extra_hour_rate >= 0),
  base_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (base_amount >= 0),
  expected_working_days_per_month INTEGER NOT NULL DEFAULT 26,
  expected_working_hours_per_day NUMERIC(4, 2) NOT NULL DEFAULT 8.00,
  weekly_holidays TEXT[] NOT NULL DEFAULT ARRAY['Sunday'],
  paid_leave_allowance_per_month INTEGER NOT NULL DEFAULT 2,
  overtime_rate_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.50,
  payment_date_of_month INTEGER NOT NULL DEFAULT 30,
  fixed_monthly_absence_policy VARCHAR(30) NOT NULL DEFAULT 'no_deduction',
  include_overtime_in_monthly BOOLEAN NOT NULL DEFAULT true,
  allowances JSONB NOT NULL DEFAULT '[]'::jsonb,
  deductions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. FINANCIAL RECORDS TABLES
-- ============================================================================

-- 3.1 Expenses
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL,
  date DATE NOT NULL,
  time TIME,
  payment_method VARCHAR(30) NOT NULL DEFAULT 'Cash',
  notes TEXT,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurring_frequency VARCHAR(20) NOT NULL DEFAULT 'None',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.2 Salary Payouts
CREATE TABLE IF NOT EXISTS public.salary_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
  payment_date DATE NOT NULL,
  salary_type VARCHAR(30) NOT NULL,
  base_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  present_days INTEGER NOT NULL DEFAULT 0,
  absent_days INTEGER NOT NULL DEFAULT 0,
  leave_days INTEGER NOT NULL DEFAULT 0,
  holiday_days INTEGER NOT NULL DEFAULT 0,
  total_working_hours NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
  overtime_hours NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
  gross_salary NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  total_allowances NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  total_deductions NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  net_salary NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(20) NOT NULL DEFAULT 'Paid',
  notes TEXT,
  synced_to_income_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_user_salary_period UNIQUE (user_id, period_month)
);

-- 3.3 Incomes
CREATE TABLE IF NOT EXISTS public.incomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL,
  date DATE NOT NULL,
  time TIME,
  notes TEXT,
  salary_payout_id UUID REFERENCES public.salary_payouts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Circular FK link from salary_payouts to incomes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_salary_payout_income'
  ) THEN
    ALTER TABLE public.salary_payouts 
      ADD CONSTRAINT fk_salary_payout_income 
      FOREIGN KEY (synced_to_income_id) 
      REFERENCES public.incomes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3.4 Work Attendance Records
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL CHECK (date <= CURRENT_DATE),
  status VARCHAR(20) NOT NULL CHECK (status IN ('Present', 'Absent', 'Leave', 'Holiday')),
  check_in_time TIME,
  check_out_time TIME,
  break_duration_minutes INTEGER DEFAULT 0,
  calculated_hours NUMERIC(5, 2) DEFAULT 0.00,
  extra_hours NUMERIC(5, 2) DEFAULT 0.00,
  daily_earned_salary NUMERIC(12, 2) DEFAULT 0.00,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_user_attendance_date UNIQUE (user_id, date)
);

-- 3.5 Debts (Money Lent / Borrowed)
CREATE TABLE IF NOT EXISTS public.debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  type VARCHAR(10) NOT NULL DEFAULT 'lent' CHECK (type IN ('lent', 'borrowed')),
  original_amount NUMERIC(12, 2) NOT NULL CHECK (original_amount > 0),
  transaction_date DATE NOT NULL,
  due_date DATE,
  description TEXT,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Partial', 'Paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.6 Debt Repayments
CREATE TABLE IF NOT EXISTS public.debt_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id UUID NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  repayment_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.7 Savings Goals (Funds & Reserves)
CREATE TABLE IF NOT EXISTS public.savings_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_amount NUMERIC(12, 2) NOT NULL CHECK (target_amount >= 0),
  current_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (current_amount >= 0),
  start_date DATE NOT NULL,
  target_date DATE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.8 Savings Transactions (Deposits & Withdrawals)
CREATE TABLE IF NOT EXISTS public.savings_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  savings_goal_id UUID NOT NULL REFERENCES public.savings_goals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
  date DATE NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.9 Goals & Dreams
CREATE TABLE IF NOT EXISTS public.goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type VARCHAR(10) NOT NULL CHECK (type IN ('goal', 'dream')),
  category TEXT NOT NULL,
  target_amount NUMERIC(12, 2),
  current_amount NUMERIC(12, 2) DEFAULT 0.00,
  target_date DATE,
  priority VARCHAR(10) NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High')),
  status VARCHAR(20) NOT NULL DEFAULT 'In Progress' CHECK (status IN ('Not Started', 'In Progress', 'Completed', 'Paused')),
  cover_image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================================
-- 4. PERFORMANCE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON public.expenses(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_incomes_user_date ON public.incomes(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON public.attendance_records(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_debts_user_status ON public.debts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_debt_repayments_debt_id ON public.debt_repayments(debt_id);
CREATE INDEX IF NOT EXISTS idx_savings_tx_goal_id ON public.savings_transactions(savings_goal_id);
CREATE INDEX IF NOT EXISTS idx_salary_payouts_user_period ON public.salary_payouts(user_id, period_month);

-- ============================================================================
-- 5. ATOMIC FINANCIAL INTEGRITY TRIGGERS & FUNCTIONS
-- ============================================================================

-- 5.1 Automated User Setup Trigger on auth.users Signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);

  INSERT INTO public.salary_configs (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5.2 Atomic Savings Balance Maintenance Trigger
CREATE OR REPLACE FUNCTION public.sync_savings_goal_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_total NUMERIC(12, 2);
  v_goal_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_goal_id := OLD.savings_goal_id;
  ELSE
    v_goal_id := NEW.savings_goal_id;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE -amount END), 0.00)
  INTO v_total
  FROM public.savings_transactions
  WHERE savings_goal_id = v_goal_id;

  IF v_total < 0 THEN
    RAISE EXCEPTION 'Withdrawal exceeds available savings balance.';
  END IF;

  UPDATE public.savings_goals
  SET current_amount = v_total
  WHERE id = v_goal_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_savings_balance ON public.savings_transactions;
CREATE TRIGGER trg_sync_savings_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.savings_transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_savings_goal_balance();

-- 5.3 Atomic Debt Status Maintenance & Overpayment Prevention Trigger
CREATE OR REPLACE FUNCTION public.sync_debt_status()
RETURNS TRIGGER AS $$
DECLARE
  v_debt_id UUID;
  v_original NUMERIC(12, 2);
  v_repaid NUMERIC(12, 2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_debt_id := OLD.debt_id;
  ELSE
    v_debt_id := NEW.debt_id;
  END IF;

  SELECT original_amount INTO v_original
  FROM public.debts
  WHERE id = v_debt_id;

  SELECT COALESCE(SUM(amount), 0.00) INTO v_repaid
  FROM public.debt_repayments
  WHERE debt_id = v_debt_id;

  IF v_repaid > v_original THEN
    RAISE EXCEPTION 'Repayment amount exceeds remaining debt balance (Original: %, Total Repaid: %).', v_original, v_repaid;
  END IF;

  UPDATE public.debts
  SET 
    status = CASE 
      WHEN v_repaid >= v_original THEN 'Paid'
      WHEN v_repaid > 0 THEN 'Partial'
      ELSE 'Pending'
    END,
    updated_at = NOW()
  WHERE id = v_debt_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_debt_status ON public.debt_repayments;
CREATE TRIGGER trg_sync_debt_status
  AFTER INSERT OR UPDATE OR DELETE ON public.debt_repayments
  FOR EACH ROW EXECUTE FUNCTION public.sync_debt_status();

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- 6.1 Enable RLS on all public tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

-- 6.2 Profiles Policies
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (id = auth.uid());

-- 6.3 User Settings Policies
CREATE POLICY "user_settings_select_own" ON public.user_settings FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "user_settings_insert_own" ON public.user_settings FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_settings_update_own" ON public.user_settings FOR UPDATE USING (user_id = auth.uid());

-- 6.4 Salary Configs Policies
CREATE POLICY "salary_configs_select_own" ON public.salary_configs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "salary_configs_insert_own" ON public.salary_configs FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "salary_configs_update_own" ON public.salary_configs FOR UPDATE USING (user_id = auth.uid());

-- 6.5 Salary Payouts Policies
CREATE POLICY "salary_payouts_all_own" ON public.salary_payouts FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 6.6 Incomes Policies
CREATE POLICY "incomes_all_own" ON public.incomes FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 6.7 Expenses Policies
CREATE POLICY "expenses_all_own" ON public.expenses FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 6.8 Attendance Records Policies
CREATE POLICY "attendance_all_own" ON public.attendance_records FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 6.9 Debts Policies
CREATE POLICY "debts_all_own" ON public.debts FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 6.10 Debt Repayments Policies
CREATE POLICY "debt_repayments_all_own" ON public.debt_repayments FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 6.11 Savings Goals Policies
CREATE POLICY "savings_goals_all_own" ON public.savings_goals FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 6.12 Savings Transactions Policies
CREATE POLICY "savings_tx_all_own" ON public.savings_transactions FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 6.13 Goals Policies
CREATE POLICY "goals_all_own" ON public.goals FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
