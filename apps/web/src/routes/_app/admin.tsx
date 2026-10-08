import { createFileRoute, redirect } from '@tanstack/react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InvitesPanel } from '@/features/admin/InvitesPanel';
import { UsersPanel } from '@/features/admin/UsersPanel';

export const Route = createFileRoute('/_app/admin')({
  beforeLoad: ({ context }) => {
    if (context.me.user.role !== 'admin') throw redirect({ to: '/' });
  },
  component: AdminPage,
});

function AdminPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
      <Tabs defaultValue="invites">
        <TabsList>
          <TabsTrigger value="invites">Invites</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>
        <TabsContent value="invites" className="pt-4">
          <InvitesPanel />
        </TabsContent>
        <TabsContent value="users" className="pt-4">
          <UsersPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
