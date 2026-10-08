import { useQuery } from '@tanstack/react-query';
import { Bot, ClipboardPaste, Cpu } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { meQuery } from '@/lib/queries';
import { ApiPanel } from './ApiPanel';
import { BrowserPanel } from './BrowserPanel';
import { CopyPromptPanel } from './CopyPromptPanel';
import type { SourceProps } from './types';

type Tab = 'manual' | 'api' | 'browser';

export function SourceCard(props: SourceProps & { initialRaw: string | null }) {
  const { data: me } = useQuery(meQuery);
  const preferred = me?.profile.defaultAiSource ?? 'manual';
  const [tab, setTab] = useState<Tab>(
    props.initialRaw ? 'manual' : preferred.startsWith('api:') ? 'api' : (preferred as Tab),
  );
  const preferredCredential = preferred.startsWith('api:') ? preferred.slice(4) : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>2. Get words</CardTitle>
        <CardDescription>
          Pick how the word list is generated. You review everything before it is saved.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="grid h-auto w-full grid-cols-3">
            <TabsTrigger value="manual" className="flex-col gap-0.5 py-2 sm:flex-row sm:gap-1.5">
              <ClipboardPaste /> <span className="text-xs sm:text-sm">Copy &amp; paste</span>
            </TabsTrigger>
            <TabsTrigger value="api" className="flex-col gap-0.5 py-2 sm:flex-row sm:gap-1.5">
              <Bot /> <span className="text-xs sm:text-sm">My API key</span>
            </TabsTrigger>
            <TabsTrigger value="browser" className="flex-col gap-0.5 py-2 sm:flex-row sm:gap-1.5">
              <Cpu /> <span className="text-xs sm:text-sm">On this device</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="manual" className="pt-4">
            <CopyPromptPanel {...props} />
          </TabsContent>
          <TabsContent value="api" className="pt-4">
            <ApiPanel {...props} preferredCredentialId={preferredCredential} />
          </TabsContent>
          <TabsContent value="browser" className="pt-4">
            <BrowserPanel {...props} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
