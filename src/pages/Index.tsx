import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Activity, Calendar, FileText, Stethoscope, Users } from 'lucide-react';

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10">
      <nav className="bg-card border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="text-xl font-bold">HealthCare Portal</h1>
          </div>
          <Button onClick={() => navigate('/auth')}>Get Started</Button>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-5xl font-bold tracking-tight">
              Modern Healthcare <span className="text-primary">Management</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Connect patients with doctors seamlessly. Book appointments, manage consultations, and access medical records - all in one place.
            </p>
          </div>

          <div className="flex justify-center gap-4">
            <Button size="lg" onClick={() => navigate('/auth')}>
              Book Appointment
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/auth')}>
              Doctor Portal
            </Button>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mt-16">
            <div className="bg-card border rounded-lg p-6 space-y-3">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <Calendar className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg">Easy Scheduling</h3>
              <p className="text-sm text-muted-foreground">
                Book appointments with specialists in just a few clicks. Get real-time confirmation from doctors.
              </p>
            </div>

            <div className="bg-card border rounded-lg p-6 space-y-3">
              <div className="w-12 h-12 bg-secondary/10 rounded-lg flex items-center justify-center">
                <FileText className="w-6 h-6 text-secondary" />
              </div>
              <h3 className="font-semibold text-lg">Digital Records</h3>
              <p className="text-sm text-muted-foreground">
                Access consultation notes, prescriptions, and medical history anytime, anywhere.
              </p>
            </div>

            <div className="bg-card border rounded-lg p-6 space-y-3">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <Stethoscope className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-lg">AI-Powered Insights</h3>
              <p className="text-sm text-muted-foreground">
                Get AI-generated summaries of consultations for quick understanding and better care.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
