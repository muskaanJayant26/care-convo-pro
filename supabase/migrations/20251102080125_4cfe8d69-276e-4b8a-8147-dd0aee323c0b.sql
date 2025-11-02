-- Allow all authenticated users to view doctor roles so patients can select doctors
CREATE POLICY "Anyone can view doctor roles"
  ON public.user_roles FOR SELECT
  USING (role = 'doctor');