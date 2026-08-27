// The Extractor's prompt (Issue #22). Per docs/design.md's Extractor row
// and the charter's "clinician states facts directly" framing, this job is
// narrower than lucy's own extractor (murmurpv/lucy's
// src/prompts/extractor.ts): a clinician answers a direct question about a
// known set of fields, rather than a patient telling an ambiguous
// narrative a model has to mine for evidence. The prompt below is sized to
// that narrower job, not copied from lucy's.
//
// The deterministic grounding check in src/lib/extraction-validator.ts
// re-verifies everything this prompt promises (quote must be a real,
// literal substring of the cited clinician turn) — nothing here is
// load-bearing for safety on its own, same posture lucy documents for its
// own prompt.
import { z } from "zod";
import { FORM_3500_FIELDS, legalEnumOptions, type FormFieldSpec } from "../lib/form-3500-fields";
import { TOPICS, repeatGroupOfLaterInstanceField, type NextStep, type RepeatGroup, type Topic } from "../lib/topics";
import type { TalkTurn } from "../lib/talk";

// Derived from TOPICS' actual data, not hand-listed — topics.ts is the
// single source of truth for which repeat groups exist (RepeatGroup is a
// type only, with no runtime values of its own to import). A third repeat
// group added there is picked up here automatically; a hand-typed
// z.enum([...]) would otherwise silently under-enumerate.
export const REPEAT_GROUPS = Array.from(
  new Set(TOPICS.map((t) => t.repeatGroup).filter((g): g is RepeatGroup => g !== null)),
) as [RepeatGroup, ...RepeatGroup[]];

// lucy's docs/SECRETS-AND-COSTS.md (dated 2026-07-27) named Sonnet 4.6;
// Sonnet 5 has since superseded it as the current Sonnet-tier model
// (per this account's claude-api skill reference, cached 2026-06-24). This
// unit matches lucy's chosen TIER (Sonnet, not Haiku — Issue #22's scoping
// conversation), not the specific point-release lucy happened to name.
export const EXTRACTOR_MODEL = "claude-sonnet-5";

// **Not a live prompt: a frozen measurement baseline.** This is the
// narrow, ask-scoped per-turn prompt from before Issue #44 widened the
// sweep. Nothing in src has sent it since; the only caller is
// scripts/cost-widened-turn.ts, which needs it byte-for-byte unchanged to
// price the widening against its own pre-widening baseline (design.md's
// cost posture, and the measurement #71 still owes). ask-copy.md's
// "Consequences for the machinery" item 3 supersedes its "never propose
// for an enum or checkbox field" instruction — superseded in the LIVE
// prompt (FOLLOWUP_EXTRACTOR_INSTRUCTIONS below, which now carries the
// derive rules), not by editing a string whose whole value is that it has
// not changed. Do not wire this to anything.
export const EXTRACTOR_SYSTEM = `You are the extraction component of wilson, a clinician-facing tool for reporting adverse drug events to the FDA (Form 3500). Your only job: read a conversation transcript between a clinician and an intake assistant, and propose structured field values that are directly grounded in what the CLINICIAN said in their latest message.

You never converse. You never decide what to ask next. You only propose candidates with supporting evidence, and a deterministic validator decides what is actually written to the record. Candidates that fail the validator are discarded, so propose only what you can ground.

## The provenance contract (your hard rule)

Every candidate carries exactly one quote: a contiguous span copied exactly from a CLINICIAN turn (never from a talker/assistant turn, never stitched across turns). The validator rejects any quote that does not appear, after light normalization (case, punctuation, whitespace), inside the referenced clinician turn's text. Never paraphrase a quote, and never invent one.

A candidate's "quote" is not required to literally contain its "value" — clinicians phrase things referentially ("the water pill" grounds "furosemide"). What must be real is the quote itself, not a verbatim match between quote and value.

## Field candidates — text/date fields only

You will be given a specific list of open fields (id + label), each one either "text" or "date" type. Propose a candidate only for a field in that list — never invent a field id, and never propose for an enum or checkbox field (those are resolved by direct UI selection, not by you).

For each open field, decide in this order:

- Did the clinician address this field at all in their latest message — answering it directly, or volunteering it? If not, propose nothing for it. Do not fill from context, medical plausibility, or your own knowledge.
- Did they give a usable value? -> kind "value", with that value and the quote that grounds it.
- Did they explicitly say they don't know or don't have that information? -> kind "unknown".
- Did they explicitly decline to answer, or say it doesn't apply? -> kind "declined".

One clinician message can ground several field candidates at once — sweep every open field you were given, not just the first one the message seems to answer.

## Repeat-group decisions

Some conversations ask a yes/no-shaped question about whether another instance of a repeating group exists (e.g. "was there a second suspect product?", "any other concomitant medications?"). When the transcript's last TALKER turn is asking exactly that, and the clinician's latest message answers it, propose a repeatDecision instead of (or alongside) field candidates:

- repeatGroup: the group name given to you for this question.
- count: the total number of instances the clinician has now confirmed exist, INCLUDING the one(s) already established. "No, that's the only one" after suspect-product instance 1 means count 1. "Yes, there was a second one" means count 2.
- quote: the same grounding rule as any other candidate — a real, contiguous span of the clinician's words.

Only ever propose a repeatDecision when you were actually told this is a repeat-group question, and only when the clinician's latest message actually answers it. If they answered something else instead (e.g. volunteered a new field value without addressing the repeat question), propose no repeatDecision.

## Never propose

- A field not in the given open-fields list.
- A value inferred from anything other than the clinician's own words in their latest message.
- A quote from anywhere but a CLINICIAN turn.
- More than one repeatDecision per turn.`;

// Shared with src/prompts/narrative-extractor.ts (Issue #41) — a quote is
// the same shape regardless of which extraction job is asking for one, and
// REPEAT_GROUPS above is derived from TOPICS itself, not job-specific.
export const QuoteSchema = z.object({
  turnIndex: z.number().int().describe("Index into the numbered transcript below, pointing at a CLINICIAN turn."),
  text: z.string().describe("A contiguous, verbatim span copied from that turn's text."),
});

const FieldCandidateSchema = z.discriminatedUnion("kind", [
  z.object({ fieldId: z.string(), kind: z.literal("value"), value: z.string(), quote: QuoteSchema }),
  z.object({ fieldId: z.string(), kind: z.literal("unknown"), quote: QuoteSchema }),
  z.object({ fieldId: z.string(), kind: z.literal("declined"), quote: QuoteSchema }),
]);

const RepeatDecisionSchema = z.object({
  repeatGroup: z.enum(REPEAT_GROUPS),
  count: z.number().int(),
  quote: QuoteSchema,
});

export const EXTRACTION_RESPONSE_SCHEMA = z.object({
  candidates: z.array(FieldCandidateSchema),
  repeatDecision: RepeatDecisionSchema.nullable(),
});

export type ExtractionResponse = z.infer<typeof EXTRACTION_RESPONSE_SCHEMA>;

function renderTranscript(transcript: TalkTurn[]): string {
  return transcript
    .map((turn, i) => `[${i}] ${turn.role === "clinician" ? "CLINICIAN" : "TALKER"}: ${turn.text}`)
    .join("\n");
}

function renderOpenFields(fields: FormFieldSpec[]): string {
  return fields.map((f) => `- ${f.id} (${f.type}): ${f.label}`).join("\n");
}

// The user-turn content for one extraction call. `transcript` must already
// include the clinician's latest message as its last entry — its index in
// this array is what the model is told to cite, and it's the same array
// the caller must later pass to validateCandidates()/validateRepeatCandidate()
// so quote indices line up (see src/lib/extract.ts).
// The frozen baseline's user-content builder — same standing as
// EXTRACTOR_SYSTEM above, and the same single caller. The extraction
// eval's dry check used to build its content here, which meant it
// validated every fixture against a prompt no live run had sent in weeks;
// it now builds what production builds (scripts/eval-extraction.ts).
export function buildExtractionUserContent(
  step: NextStep,
  fields: FormFieldSpec[],
  transcript: TalkTurn[],
): string {
  const transcriptBlock = `Numbered transcript (quote only from a CLINICIAN line, citing its number as turnIndex):\n${renderTranscript(transcript)}`;

  if (step.kind === "topic") {
    const openFields = fields.filter((f) => step.fieldIds.includes(f.id));
    return `${transcriptBlock}\n\nOpen fields for this turn (text/date only):\n${renderOpenFields(openFields)}\n\nPropose field candidates grounded in the clinician's latest message. This is not a repeat-group question — propose no repeatDecision.`;
  }

  if (step.kind === "repeat-decision") {
    return `${transcriptBlock}\n\nThe talker's last turn asked whether another instance of the "${step.repeatGroup}" group exists, after instance ${step.afterInstance}. If the clinician's latest message answers that, propose a repeatDecision (repeatGroup: "${step.repeatGroup}", count including the confirmed instance(s)). There are no open text/date fields for this turn.`;
  }

  return `${transcriptBlock}\n\nThere is nothing left to ask — propose nothing.`;
}

// ---------------------------------------------------------------------------
// The widened per-turn follow-up sweep (Issue #44, design.md "Follow-up
// turns are mined for everything still open" + "Cost posture"). Unlike
// buildExtractionUserContent() above — scoped to a single step's ≤3
// fields, kept UNCHANGED here as the pre-widening "narrow" baseline
// scripts/cost-widened-turn.ts measures against — this pass is extracted
// against the OPEN field set (the ask's own fields, plus anything else
// still `unasked`/`unknown`), and its system prompt carries the full
// field manifest so the model can also recognize a volunteered
// correction to an already-answered field or a later repeat instance,
// neither of which is ever in the "open" set. src/lib/extract.ts is the
// one caller that wires this to a real model and to
// validateCandidates()/classifyFollowUpActions()'s write-policy checks —
// nothing here decides what gets written.
// ---------------------------------------------------------------------------

const FOLLOWUP_EXTRACTOR_INSTRUCTIONS = `You are the extraction component of wilson, a clinician-facing tool for reporting adverse drug events to the FDA (Form 3500). Your job: read a conversation transcript between a clinician and an intake assistant, and propose structured field values grounded in what the CLINICIAN said in their LATEST message — the last entry in the numbered transcript you're given.

You never converse. You never decide what to ask next. You only propose candidates with supporting evidence, and a deterministic validator decides what is actually written to the record. Candidates that fail the validator are discarded, so propose only what you can ground.

## The provenance contract (your hard rule)

Every candidate carries exactly one quote: a contiguous span copied exactly from the clinician's LATEST message — the last turn in the transcript, never an earlier one, and never the opening narrative if it appears as turn [0]. The validator independently rejects any quote citing a different turn, not just a quote that fails to match its text.

A candidate's "quote" is not required to literally contain its "value" — clinicians phrase things referentially ("the water pill" grounds "furosemide"). What must be real is the quote itself.

## The full field manifest, below this prompt

You are given every field on the form — id, type, label, and (for enum fields) legal options — not just the ones currently open. Most of your work is against the fields you're separately told are OPEN this turn (see the user turn); propose those first. But the clinician sometimes volunteers more than what was asked:

- A correction to a field that sounds already answered (e.g. "actually, make that the 19th") — propose it anyway, citing the correct field id from the full manifest below. A deterministic step downstream decides whether that's a fresh write or a correction offer; you don't need to know which.
- A field belonging to a repeat group's instance 2 or later (marked "[later repeat instance...]" in the manifest below) — e.g. a second suspect product's name. Propose it with that field's real id if the clinician clearly states it; a deterministic step downstream turns this into a recorded suggestion rather than a direct write, so getting the field id right matters more than deciding what happens to it.

## Field candidates — every field type

For each field you address, decide in this order:

- Did the clinician's LATEST message address this field at all? If not, propose nothing for it.
- Did they give a usable value? -> kind "value". For a checkbox field, the only legal values are the literal strings "true"/"false". For an enum field, the value must be spelled exactly as one of its listed legal options.
- Did they explicitly say they don't know or don't have that information? -> kind "unknown".
- Did they explicitly decline to answer, or say it doesn't apply? -> kind "declined".

One message can ground several field candidates at once — sweep broadly, not just the first field the message seems to answer.

## Companion fields — one fact, several boxes

Form 3500 keeps some single facts in several fields at once. When the clinician states the fact, propose every field it fills, each grounded on the same quote:

- **Units stated in the words.** "875 mg" fills the strength AND its unit enum; "1 tablet twice daily" fills the dose, its unit, and the frequency; "six months of therapy" fills the duration and its duration-unit enum. Propose a unit ONLY from what the clinician actually said — never from what seems medically likely. A bare number with no unit: propose the number alone and leave the unit open.
- **"Other" companions.** Frequency and route are enums. If the clinician's stated value matches one of the legal options, use it. If it matches none of them ("every other Tuesday"), propose the enum's "Other" option where one exists AND propose the free-text Other-companion field with the clinician's own words.
- **One-hot and multi-select groups.** Propose "true" for each box the clinician's answer selects. You do NOT need to propose "false" for the rest of a group whose question was just asked — a deterministic step completes it. Propose "false" only where the clinician said so explicitly ("no, it never came back", "none of those").

## Repeat-group decisions

Some turns ask a yes/no-shaped question about whether another instance of a repeating group exists. When the transcript's last TALKER turn is asking exactly that, and the clinician's latest message answers it, propose a repeatDecision — but you may ALSO propose ordinary field candidates from the very same message, if the clinician volunteered more than a yes/no.

## Never propose

- A value inferred from anything other than the clinician's own words in their latest message.
- A quote from anywhere but the clinician's latest message.
- A checkbox/enum value that isn't one of that field's stated legal options.
- More than one repeatDecision per turn.`;

function renderFullManifest(fields: FormFieldSpec[], topics: Topic[] = TOPICS): string {
  return fields
    .map((f) => {
      const laterInstanceGroup = repeatGroupOfLaterInstanceField(f.id, topics);
      const suffix =
        laterInstanceGroup !== null
          ? " [later repeat instance — only if the clinician clearly states a distinct new one]"
          : "";
      if (f.type === "enum") {
        const options = legalEnumOptions(f)
          .map((o) => `"${o}"`)
          .join(", ");
        return `- ${f.id} (enum — legal values: ${options}): ${f.label}${suffix}`;
      }
      return `- ${f.id} (${f.type}): ${f.label}${suffix}`;
    })
    .join("\n");
}

// The invariant, cacheable system prompt (design.md's cost posture: "the
// cached prefix carries the full manifest and option lists, invariant
// across the session"). Identical for every clinician and every session
// — nothing here depends on session/record state, which is exactly what
// makes it the strongest possible cache-hit shape: a single
// cache_control breakpoint on this text (src/lib/extract.ts) is warm for
// the whole app, not just one session, as long as SOME call anywhere hit
// it within the TTL.
export function buildFollowUpExtractorSystem(
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
  topics: Topic[] = TOPICS,
): string {
  return `${FOLLOWUP_EXTRACTOR_INSTRUCTIONS}\n\n## Full field manifest\n\n${renderFullManifest(fields, topics)}`;
}

// The per-turn (uncached) suffix: which fields are open THIS turn, named
// by id only (their full id/type/label/options are already in the cached
// system prompt above — repeating them here would grow, not shrink, with
// every turn, defeating the cache). design.md is explicit that the open
// set belongs in the suffix, "never carved out of the prefix" — this
// function never touches buildFollowUpExtractorSystem()'s output.
//
// `askFieldIds` names what this turn's own ask actually phrased — the
// caller's job to compute (src/lib/extract.ts's `askFieldIds`, sliced to
// MAX_FIELDS_PER_ASK), not this function's: re-slicing step.fieldIds in
// here would risk drifting from the SAME cap classifyFollowUpActions()
// uses to decide in-ask vs. out-of-ask (extract.ts is the one place that
// must agree with itself). Using the raw, uncapped step.fieldIds instead
// used to tell the model this turn asked about fields the clinician was
// never actually shown a question about (reviewer pass on PR #64).
export function buildFollowUpUserContent(
  step: NextStep,
  askFieldIds: string[],
  openFields: FormFieldSpec[],
  transcript: TalkTurn[],
): string {
  const transcriptBlock = `Numbered transcript (quote ONLY from the LAST turn above, which is always the clinician's current message):\n${renderTranscript(transcript)}`;
  const openBlock = `Fields open this turn (unasked or previously marked unknown — prioritize these; full details are in the manifest above):\n${openFields.map((f) => `- ${f.id}`).join("\n") || "(none)"}`;

  if (step.kind === "topic") {
    return `${transcriptBlock}\n\n${openBlock}\n\nThis turn's own ask named: ${askFieldIds.join(", ")}. Propose field candidates grounded in the clinician's latest message — for any field in the full manifest above, not only the open list, if they clearly addressed it. This is not a repeat-group question — propose no repeatDecision.`;
  }

  if (step.kind === "repeat-decision") {
    return `${transcriptBlock}\n\n${openBlock}\n\nThe talker's last turn asked whether another instance of the "${step.repeatGroup}" group exists, after instance ${step.afterInstance}. If the clinician's latest message answers that, propose a repeatDecision (repeatGroup: "${step.repeatGroup}", count including the confirmed instance(s)). You may also propose ordinary field candidates grounded in the same message.`;
  }

  return `${transcriptBlock}\n\n${openBlock}\n\nThere is nothing left to ask — propose nothing.`;
}
