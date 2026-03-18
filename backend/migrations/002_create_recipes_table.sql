-- Supabase SQL Migration: Create recipes table
-- Run this in Supabase Dashboard > SQL Editor AFTER 001_create_users_table.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    ingredients JSONB,
    instructions JSONB,
    tags JSONB,
    image_url TEXT,
    prep_time TEXT,
    cook_time TEXT,
    servings TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON public.recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_recipes_created_at ON public.recipes(created_at DESC);

-- Disable RLS (backend uses service_role key which bypasses it anyway)
ALTER TABLE public.recipes DISABLE ROW LEVEL SECURITY;

-- Permissions
GRANT ALL ON public.recipes TO service_role;

-- Auto-update updated_at
DROP TRIGGER IF EXISTS update_recipes_updated_at ON public.recipes;
CREATE TRIGGER update_recipes_updated_at
    BEFORE UPDATE ON public.recipes
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- VERIFICATION:
-- SELECT * FROM public.recipes LIMIT 1;
-- ============================================================
