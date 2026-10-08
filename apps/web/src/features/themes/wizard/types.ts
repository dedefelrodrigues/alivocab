import type { CefrLevel, ProposalDto } from '@alivocab/shared';

export type ThemeSetup = {
  themeName: string;
  description: string;
  count: number;
  level: CefrLevel | null;
  /** Set when adding words to an existing theme. */
  themeId?: string;
};

export type SourceProps = {
  setup: ThemeSetup;
  /** Validates the setup form; returns false (and shows errors) when incomplete. */
  ensureValid: () => boolean;
  onProposal: (proposal: ProposalDto) => void;
};
