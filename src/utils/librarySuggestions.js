/**
 * The "Worth a topic?" block, as data.
 *
 * Two front doors, one mechanism (the 19 Aug decision): for something you can
 * already name you make it yourself and it starts gathering; for something you
 * can't, the app says what it noticed and you decide. The block below is both —
 * filled slots are what the app noticed, and the leftover slot is the door you
 * walk through when you already know the name.
 *
 * Pure functions only, so they can be unit-tested without a DOM. The hook that
 * talks to Supabase is useLibrarySuggestions.js.
 */

/**
 * A fixed block, never more.
 *
 * Nothing in the Library is a queue (rule 5). Five cards fit one row on a
 * laptop and wrap once on a phone; a sixth starts needing a scrollbar, and a
 * list you scroll through is a backlog.
 */
export const MAX_SUGGESTION_SLOTS = 5

/** Translate a persisted library_suggestions row into app naming, the way
 *  pageModel.toClientPage does for pages. */
export function toClientSuggestion(row) {
  if (!row) return null
  return {
    id: row.id,
    scope: row.scope,
    sectionId: row.section_id ?? null,
    title: row.title ?? '',
    // One model-written sentence. The only such sentence in the Library, and
    // the reason this block is a panel and not part of the page.
    why: row.why ?? '',
    evidencePageIds: row.evidence_page_ids ?? [],
  }
}

/**
 * The slots to render: what was noticed, then one door to make your own.
 *
 * THE BLOCK NEVER EMPTIES. At zero suggestions it is a single "make your own"
 * card, which is the whole answer to a Library that has two things in it — the
 * page reads as usable rather than broken. At the cap it is five suggestions
 * and no door, because the door is also on the sidebar footer and a sixth card
 * would push the block into scrolling.
 *
 * @param {Array<object>} suggestions newest-first, already filtered to the live set
 * @param {number} max how many slots the block has
 * @returns {Array<{ kind: 'suggestion'|'placeholder', suggestion?: object }>}
 */
export function buildSuggestionSlots(suggestions = [], max = MAX_SUGGESTION_SLOTS) {
  const cards = (Array.isArray(suggestions) ? suggestions : [])
    .slice(0, max)
    .map((suggestion) => ({ kind: 'suggestion', suggestion }))
  if (cards.length >= max) return cards
  return [...cards, { kind: 'placeholder' }]
}

/** What the two scopes are called, in the user's words. One place, because the
 *  same nouns appear on the card button, in the modal, and in the sidebar
 *  footer, and three copies would drift. */
export const SCOPE_WORDS = {
  topic: {
    noun: 'topic',
    make: 'Make it a topic',
    heading: 'New topic',
    placeholder: 'Fueling',
    hint: 'It starts empty and gathers what you save from here on.',
  },
  section: {
    noun: 'section',
    make: 'Make it a section',
    heading: 'New section',
    placeholder: 'Health IT',
    hint: 'A standing area of interest. It starts empty and gathers.',
  },
}

/**
 * The document a brand-new topic page opens with.
 *
 * Deliberately the same two lines renderTopicCatalog produces for a topic with
 * nothing in it — the next rebuild overwrites this page with exactly that. It is
 * duplicated across the app/edge-function boundary rather than shared because
 * _shared/libraryCatalog.ts is Deno TypeScript and this is the browser bundle;
 * the alternative is a brand-new topic reading as a blank page until something
 * is next saved, which looks broken.
 *
 * Block ids are left off on purpose: the editor's id extension assigns them on
 * load, the same way it does for EMPTY_DOC.
 */
export function buildNewTopicDoc() {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            marks: [{ type: 'italic' }, { type: 'textStyle', attrs: { color: '#A8A29E' } }],
            text:
              'This page is written by the app and rewritten whenever something new is saved — ' +
              'anything you type here will be replaced. Your own words live on the saved pages, ' +
              'under “My notes”.',
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Nothing filed here yet. Save something to this section and it will show up.',
          },
        ],
      },
    ],
  }
}
