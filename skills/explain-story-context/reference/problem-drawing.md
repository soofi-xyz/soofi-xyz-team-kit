# Problem drawing

Use this reference with [SKILL.md](../SKILL.md#problem-drawing) when drawing a
story's problem. The drawing replaces the prose problem statement: the reader
compares what really happened with what the system records and derives, and
sees the defect without reading code.

## Choose the events

1. List the real-world events behind the bug in time order, taken from the
   source of truth: the system of record, document or process that decides
   what really happened.
2. Remove events one at a time. Keep an event only if the bug disappears
   without it.
3. Verify the remaining sequence against code or data, not memory. If an
   existing workaround corrects the outcome after one cycle, a single cycle
   looks correct: show two cycles, so the drawing shows the case the
   workaround misses.
4. Put the events on the horizontal axis, one column each. Label each column
   with the event and, where timing matters, its relative date (day 1, day 30).

## Lanes

| Lane | Shows | Notes |
| --- | --- | --- |
| Source of truth | What really happened at each event | Name the source in the lane label. |
| Recorded today | The values the system stores after each event | Show values, not only field names. |
| Outcome today | What the system derives from those records | Mark the wrong part in red (the theme's error color) with a label of two to four words. |
| Divider | "After the fix" | A full-width rule with no data. |
| Recorded after the fix | The values stored once the fix is in place | Highlight values that differ from today. |
| Outcome after the fix | What the system derives after the fix | It matches the source of truth. |

Place each cell directly under the event that produces it. Leave a cell empty
when the event does not change that lane.

## Legend and caption

- Add a legend with one entry for each mark used: event, stored value, correct
  outcome, wrong outcome, changed value, divider.
- Add a caption of two or three sentences under the drawing. State the root
  cause in the first sentence and what the fix changes in the second. Use an
  optional third sentence for the existing records a backfill repairs.

Example caption:

> The system keeps one status per account, so a later unrelated update
> overwrites the earlier representation status. The fix stores each status
> with its own date and derives contact eligibility from all of them.

## One drawing per mechanism

Draw each mechanism separately: the forward fix, a backfill or migration of
existing records, a cleanup, a rollback. One combined drawing hides which
mechanism repairs which record.

For a backfill or migration:

- Use one lane per case, for example: a record only in the old store; a record
  in both stores with different dates; a record only in the new store.
- In each lane, show the competing records, the one that wins, and the rule
  that picks it (for example, the earlier date, or the source of truth over a
  derived copy).
- Reuse the legend and colors of the problem drawing.

## Named examples

- Attach a real identifier or case to a drawing only after checking, against
  the source of truth, that its events follow exactly the drawn sequence.
- List cases that are similar but not identical under **Related cases**, one
  line each, stating how they differ from the drawing.
- Show only identifiers the audience may see. Keep personal data out of the
  drawing.

## Canvas notes

- Draw lanes as rows, with a fixed label column on the left and one column per
  event.
- Size columns from the available width; wrap cell text instead of shrinking
  it.
- Check that no label overlaps another label, mark or line at the narrowest
  width the canvas supports.

## Markdown fallback

When no canvas is available, draw the lanes as a fixed-width text block. Mark
the wrong outcome in capitals with its label in brackets, and say so in the
legend line under the block.

```text
Event            1. Representation      2. Unrelated           3. Next contact
                    reported               update                 run
Source of truth  represented            represented            represented
Recorded today   status: represented    status: updated        status: updated
Outcome today    excluded                                      CONTACTED
                                                               [called while represented]
------------------------------ after the fix --------------------------------------------
Recorded after   represented (day 1)    represented (day 1)    represented (day 1)
                                        updated (day 2)        updated (day 2)
Outcome after    excluded                                      excluded
```

Legend: capitals and a bracketed label mark the wrong outcome; the dashed rule
separates today from after the fix.
