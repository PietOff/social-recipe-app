-- Supabase SQL Migration: Create users table
-- This table is required for Google Sign-In authentication persistence
-- 
-- Run this SQL in your Supabase Dashboard > SQL Editor
-- 
-- ============================================================

-- Create the users table for storing authenticated users
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create an index on google_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_google_id ON public.users(google_id);

-- Create an index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- Enable Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows public read access (for user profiles)
CREATE POLICY "Users are viewable by everyone" 
ON public.users 
FOR SELECT 
USING (true);

-- Create a policy that allows users to update their own record
CREATE POLICY "Users can update their own profile" 
ON public.users 
FOR UPDATE 
USING (auth.uid()::text = google_id);

-- Create a policy that allows insert from the service role (backend)
-- Note: This requires using the service role key in your backend
CREATE POLICY "Service role can insert users" 
ON public.users 
FOR INSERT 
WITH CHECK (true);

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Grant permissions for the anon role (for public access)
GRANT SELECT ON public.users TO anon;

-- Grant permissions for the authenticated role
GRANT SELECT, INSERT, UPDATE ON public.users TO authenticated;

-- Grant permissions for the service_role (backend operations)
GRANT ALL ON public.users TO service_role;

-- ============================================================
-- VERIFICATION: Run this query after the migration to verify:
-- SELECT * FROM public.users LIMIT 1;
-- ============================================================
