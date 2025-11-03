-- Allow patients to view doctor profiles for booking appointments
CREATE POLICY "Patients can view doctor profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = profiles.id
      AND user_roles.role = 'doctor'
    )
  );