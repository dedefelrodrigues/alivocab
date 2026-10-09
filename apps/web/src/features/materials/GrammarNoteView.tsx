import type { GrammarNote, MaterialDto } from '@alivocab/shared';
import { Lightbulb } from 'lucide-react';
import { SpeakButton } from '@/features/themes/SpeakButton';

/** A grammar note: sections with explanations, example sentences (with audio) and tables. */
export function GrammarNoteView({ material }: { material: MaterialDto & { kind: 'grammar' } }) {
  const note: GrammarNote = material.content;
  return (
    <article className="space-y-6">
      {note.summary && <p className="text-lg text-muted-foreground">{note.summary}</p>}
      {note.sections.map((section) => (
        <section key={section.heading} className="space-y-3">
          <h2 className="text-xl font-semibold">{section.heading}</h2>
          <p className="leading-relaxed whitespace-pre-line">{section.explanation}</p>
          {section.table && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    {section.table.headers.map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {section.table.rows.map((row) => (
                    <tr key={row.join('|')}>
                      {row.map((cell, i) => (
                        <td
                          // biome-ignore lint/suspicious/noArrayIndexKey: cells of a fixed row
                          key={i}
                          className="px-3 py-2"
                          lang={i === 0 ? undefined : material.lang}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {section.examples.length > 0 && (
            <ul className="space-y-1.5">
              {section.examples.map((ex) => (
                <li key={ex.text} className="flex items-start gap-1">
                  <SpeakButton text={ex.text} lang={material.lang} />
                  <p>
                    <span lang={material.lang} className="font-medium">
                      {ex.text}
                    </span>
                    {ex.translation && (
                      <span className="block text-sm text-muted-foreground">{ex.translation}</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {note.tips.length > 0 && (
        <section className="space-y-2 rounded-xl border bg-muted/40 p-4">
          <h2 className="flex items-center gap-1.5 font-semibold">
            <Lightbulb className="size-4 text-primary" aria-hidden /> Tips
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            {note.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
