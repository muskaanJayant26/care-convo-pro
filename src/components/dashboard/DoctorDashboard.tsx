import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { signOut } from '@/lib/auth';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar, FileText, Bell, LogOut, Activity } from 'lucide-react';
import AppointmentsList from './AppointmentsList';
import ConsultationsList from './ConsultationsList';
import NotificationsList from './NotificationsList';

interface DoctorDashboardProps {
  user: User;
}

const DoctorDashboard = ({ user }: DoctorDashboardProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [profile, setProfile] = useState<any>(null);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary/5 via-background to-primary/5">
      <nav className="bg-card/80 backdrop-blur-md border-b shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-secondary to-secondary/80 rounded-xl flex items-center justify-center shadow-secondary">
              <Activity className="w-6 h-6 text-secondary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-secondary to-secondary/70 bg-clip-text text-transparent">Doctor Portal</h1>
              <p className="text-sm text-muted-foreground">Dr. {profile?.full_name}</p>
            </div>
          </div>
          <Button variant="outline" onClick={handleSignOut} className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive transition-colors">
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </nav>

      <div className="container mx-auto px-6 py-10">
        <Tabs defaultValue="appointments" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 bg-muted/50 p-1.5 h-auto">
            <TabsTrigger value="appointments" className="data-[state=active]:bg-background data-[state=active]:shadow-md py-3">
              <Calendar className="w-4 h-4 mr-2" />
              Appointments
            </TabsTrigger>
            <TabsTrigger value="consultations" className="data-[state=active]:bg-background data-[state=active]:shadow-md py-3">
              <FileText className="w-4 h-4 mr-2" />
              Consultations
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
                  Patient Appointments
                </CardTitle>
                <CardDescription>Manage your patient appointments</CardDescription>
              </CardHeader>
              <CardContent>
                <AppointmentsList userId={user.id} role="doctor" />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="consultations" className="animate-in fade-in-50 duration-300">
            <Card className="border-secondary/10">
              <CardHeader>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <FileText className="w-6 h-6 text-secondary" />
                  Consultations
                </CardTitle>
                <CardDescription>View and manage consultation records</CardDescription>
              </CardHeader>
              <CardContent>
                <ConsultationsList userId={user.id} role="doctor" />
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
                <CardDescription>Stay updated with appointment requests</CardDescription>
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

export default DoctorDashboard;
