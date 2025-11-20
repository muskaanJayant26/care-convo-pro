import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { signOut } from '@/lib/auth';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar, FileText, Bell, LogOut, Activity, Folder } from 'lucide-react';
import BookAppointmentDialog from './BookAppointmentDialog';
import AppointmentsList from './AppointmentsList';
import ConsultationsList from './ConsultationsList';
import NotificationsList from './NotificationsList';
import GeneralPhysicianChat from './GeneralPhysicianChat';
import MedicalRecordsList from './MedicalRecordsList';

interface PatientDashboardProps {
  user: User;
}

const PatientDashboard = ({ user }: PatientDashboardProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [profile, setProfile] = useState<any>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const fetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(data);
    };
    fetchProfile();
  }, [user.id]);

  const handleSignOut = async () => {
    await signOut();
    toast({ title: 'Logged out successfully' });
    navigate('/auth');
  };

  const handleAppointmentBooked = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <nav className="bg-card/80 backdrop-blur-md border-b shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-primary to-primary/80 rounded-xl flex items-center justify-center shadow-primary">
              <Activity className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                HealthCare Portal
              </h1>
              <p className="text-sm text-muted-foreground">Welcome, {profile?.full_name}</p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handleSignOut}
            className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive transition-colors"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </nav>

      <div className="container mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2">
            <BookAppointmentDialog userId={user.id} onAppointmentBooked={handleAppointmentBooked} />
          </div>
          <GeneralPhysicianChat patientId={user.id} />
        </div>

        {/* FIXED: Now only 4 tabs, so grid-cols-4 */}
        <Tabs defaultValue="appointments" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 bg-muted/50 p-1.5 h-auto">
            <TabsTrigger value="appointments" className="data-[state=active]:bg-background data-[state=active]:shadow-md py-3">
              <Calendar className="w-4 h-4 mr-2" />
              Appointments
            </TabsTrigger>

            <TabsTrigger value="consultations" className="data-[state=active]:bg-background data-[state=active]:shadow-md py-3">
              <FileText className="w-4 h-4 mr-2" />
              Consultations
            </TabsTrigger>

            <TabsTrigger value="records" className="data-[state=active]:bg-background data-[state=active]:shadow-md py-3">
              <Folder className="w-4 h-4 mr-2" />
              Records
            </TabsTrigger>

            <TabsTrigger value="notifications" className="data-[state=active]:bg-background data-[state=active]:shadow-md py-3">
              <Bell className="w-4 h-4 mr-2" />
              Notifications
            </TabsTrigger>
          </TabsList>

          <TabsContent value="appointments" className="animate-in fade-in-50 duration-300">
            <Card className="border-primary/10">
              <CardHeader>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Calendar className="w-6 h-6 text-primary" />
                  My Appointments
                </CardTitle>
                <CardDescription>View and manage your appointments</CardDescription>
              </CardHeader>
              <CardContent>
                <AppointmentsList userId={user.id} role="patient" key={refreshKey} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="consultations" className="animate-in fade-in-50 duration-300">
            <Card className="border-secondary/10">
              <CardHeader>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <FileText className="w-6 h-6 text-secondary" />
                  My Consultations
                </CardTitle>
                <CardDescription>View consultation notes and prescriptions</CardDescription>
              </CardHeader>
              <CardContent>
                <ConsultationsList userId={user.id} role="patient" />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="records" className="animate-in fade-in-50 duration-300">
            <Card className="border-primary/10">
              <CardHeader>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Folder className="w-6 h-6 text-primary" />
                  Medical Records
                </CardTitle>
                <CardDescription>View your test results and medical documents</CardDescription>
              </CardHeader>
              <CardContent>
                <MedicalRecordsList patientId={user.id} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications" className="animate-in fade-in-50 duration-300">
            <Card className="border-accent/10">
              <CardHeader>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Bell className="w-6 h-6 text-accent" />
                  Notifications
                </CardTitle>
                <CardDescription>Stay updated with your appointments</CardDescription>
              </CardHeader>
              <CardContent>
                <NotificationsList userId={user.id} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default PatientDashboard;
