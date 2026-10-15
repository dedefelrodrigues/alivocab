import type { CefrLevel, ProposalDto } from '@alivocab/shared';

export type ThemeSetup = {
  /** The language the words are in (an existing theme's, else chosen, default the active one). */
  lang: string;
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
