"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { useSettingsStore } from "@/store/settings-store";

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const settings = useSettingsStore();

  const save = () => toast.success("Settings saved.");

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Configure your clinic's operations, billing, and AI preferences." />

      <Tabs defaultValue="clinic">
        <TabsList className="flex w-full flex-wrap justify-start gap-1 sm:w-auto">
          <TabsTrigger value="clinic">Clinic Profile</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="prescriptions">Prescriptions</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="more">More</TabsTrigger>
        </TabsList>

        <TabsContent value="clinic" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Clinic profile</CardTitle><CardDescription>Basic information about your clinic.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Clinic name</Label>
                  <Input value={settings.clinicName} onChange={(e) => settings.updateSettings({ clinicName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Support email</Label>
                  <Input value={settings.supportEmail} onChange={(e) => settings.updateSettings({ supportEmail: e.target.value })} />
                </div>
              </div>
              <Button onClick={save}>Save changes</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appointments" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Appointment settings</CardTitle></CardHeader>
            <CardContent className="divide-y">
              <SettingRow label="Default slot duration" description="Length of a standard appointment slot">
                <Input type="number" className="w-24" value={settings.defaultSlotMinutes} onChange={(e) => settings.updateSettings({ defaultSlotMinutes: Number(e.target.value) })} />
              </SettingRow>
              <SettingRow label="Allow online booking" description="Patients can book appointments from the portal">
                <Switch checked={settings.allowOnlineBooking} onCheckedChange={(v) => settings.updateSettings({ allowOnlineBooking: v })} />
              </SettingRow>
              <SettingRow label="Allow walk-ins" description="Front desk can register walk-in patients">
                <Switch checked={settings.allowWalkIns} onCheckedChange={(v) => settings.updateSettings({ allowWalkIns: v })} />
              </SettingRow>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Billing settings</CardTitle></CardHeader>
            <CardContent className="divide-y">
              <SettingRow label="Default tax rate" description="Applied to medicines and lab tests">
                <div className="flex items-center gap-1">
                  <Input type="number" className="w-20" value={settings.taxRatePercent} onChange={(e) => settings.updateSettings({ taxRatePercent: Number(e.target.value) })} />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </SettingRow>
              <SettingRow label="Accept online payments" description="Enable UPI, card, and online payment collection">
                <Switch checked={settings.onlinePaymentsEnabled} onCheckedChange={(v) => settings.updateSettings({ onlinePaymentsEnabled: v })} />
              </SettingRow>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prescriptions" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Prescription settings</CardTitle></CardHeader>
            <CardContent className="divide-y">
              <SettingRow label="AI safety review" description="Run AI duplicate/interaction checks before saving a prescription">
                <Switch checked={settings.prescriptionAiSafetyReview} onCheckedChange={(v) => settings.updateSettings({ prescriptionAiSafetyReview: v })} />
              </SettingRow>
              <SettingRow label="Require doctor signature" description="Doctor must confirm before a prescription is finalized">
                <Switch checked={settings.requireDoctorSignature} onCheckedChange={(v) => settings.updateSettings({ requireDoctorSignature: v })} />
              </SettingRow>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Notification settings</CardTitle></CardHeader>
            <CardContent className="divide-y">
              <SettingRow label="Email notifications" description="Appointment reminders and reports via email">
                <Switch checked={settings.emailNotifications} onCheckedChange={(v) => settings.updateSettings({ emailNotifications: v })} />
              </SettingRow>
              <SettingRow label="SMS notifications" description="Appointment reminders via SMS">
                <Switch checked={settings.smsNotifications} onCheckedChange={(v) => settings.updateSettings({ smsNotifications: v })} />
              </SettingRow>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="mt-4">
          <Card>
            <CardHeader><CardTitle>AI settings</CardTitle><CardDescription>Control AI-assisted features across the platform.</CardDescription></CardHeader>
            <CardContent className="divide-y">
              <SettingRow label="Enable AI features" description="AI summaries, consultation notes, and insights">
                <Switch checked={settings.aiFeaturesEnabled} onCheckedChange={(v) => settings.updateSettings({ aiFeaturesEnabled: v })} />
              </SettingRow>
              <SettingRow label="Auto-generate patient summaries" description="Pre-generate AI summaries when opening a patient profile">
                <Switch checked={settings.aiAutoSummaries} onCheckedChange={(v) => settings.updateSettings({ aiAutoSummaries: v })} disabled={!settings.aiFeaturesEnabled} />
              </SettingRow>
              <div className="pt-3 text-xs text-muted-foreground">
                All AI output is clearly labeled and requires clinical review — Sehat AI never autonomously diagnoses, prescribes, or edits medical records.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Security</CardTitle></CardHeader>
            <CardContent className="divide-y">
              <SettingRow label="Require two-factor authentication" description="Staff must verify with a second factor at login">
                <Switch checked={settings.twoFactorRequired} onCheckedChange={(v) => settings.updateSettings({ twoFactorRequired: v })} />
              </SettingRow>
              <SettingRow label="Session timeout" description="Automatically sign out after inactivity">
                <div className="flex items-center gap-1">
                  <Input type="number" className="w-20" value={settings.sessionTimeoutMinutes} onChange={(e) => settings.updateSettings({ sessionTimeoutMinutes: Number(e.target.value) })} />
                  <span className="text-sm text-muted-foreground">min</span>
                </div>
              </SettingRow>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="more" className="mt-4">
          <Card>
            <CardHeader><CardTitle>More settings</CardTitle><CardDescription>Manage related configuration in their dedicated sections.</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              {[
                { href: "/staff", label: "Staff & Roles & Permissions" },
                { href: "/doctor-roster", label: "Doctors" },
                { href: "/audit-log", label: "Audit Logs" },
                { href: "/subscription", label: "Subscription & Billing" },
              ].map((item) => (
                <div key={item.href}>
                  <Link href={item.href} className="text-sm text-primary hover:underline">{item.label}</Link>
                  <Separator className="mt-2" />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
