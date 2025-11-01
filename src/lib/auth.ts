import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export interface AuthUser extends User {
  role?: 'doctor' | 'patient';
}

export const signUp = async (
  email: string,
  password: string,
  fullName: string,
  phone: string,
  role: 'doctor' | 'patient',
  specialization?: string,
  licenseNumber?: string
) => {
  const redirectUrl = `${window.location.origin}/`;
  
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: redirectUrl,
      data: {
        full_name: fullName,
        phone: phone,
      }
    }
  });

  if (error) return { error };
  if (!data.user) return { error: new Error("Failed to create user") };

  // Insert role into user_roles table
  const { error: roleError } = await supabase
    .from('user_roles')
    .insert({
      user_id: data.user.id,
      role,
      specialization: role === 'doctor' ? specialization : null,
      license_number: role === 'doctor' ? licenseNumber : null,
    });

  if (roleError) return { error: roleError };

  return { data, error: null };
};

export const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  return { data, error };
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  return { error };
};

export const getUserRole = async (userId: string): Promise<'doctor' | 'patient' | null> => {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data.role as 'doctor' | 'patient';
};
