import type { ThemeSummaryDto } from '@alivocab/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, errorMessage, unwrap } from '@/lib/api';

export function EditThemeDialog({
  theme,
  onClose,
}: {
  theme: ThemeSummaryDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(theme.name);
  const [description, setDescription] = useState(theme.description ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.themes[':id'].$patch({
          param: { id: theme.id },
          json: { name: name.trim(), description: description.trim() || null },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['themes'] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Name is required');
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit theme</DialogTitle>
        </DialogHeader>
        <form id="edit-theme" onSubmit={submit} className="grid gap-4">
          <FormField id="t-name" label="Name" error={error}>
            <Input
              id="t-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          <FormField id="t-desc" label="Description">
            <Input
              id="t-desc"
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-theme" disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
