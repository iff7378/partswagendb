/**
 * What changed, written for the people who use this rather than the people who
 * wrote it. Git history says "one sale line can cover many parts, or none";
 * this says you can sell a whole interior on one line.
 *
 * Newest first. Add an entry when you deploy something worth noticing -- not
 * every commit, and not the ones nobody would ever see.
 */

export type ChangeKind = 'new' | 'better' | 'fixed'

export interface Change {
  kind: ChangeKind
  text: string
}

export interface Release {
  /**
   * The day, not the build number.
   *
   * A release note has to be written before the release exists, and the build
   * number is only worked out at build time -- so keying entries on it means
   * every entry is guessing, and guesses wrong whenever a day needs a second
   * deploy. What is running is shown once at the top of the page instead.
   */
  on: string
  headline: string
  changes: Change[]
}

export const KIND_LABELS: Record<ChangeKind, string> = {
  new: 'New',
  better: 'Better',
  fixed: 'Fixed',
}

export const KIND_STYLES: Record<ChangeKind, string> = {
  new: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  better: 'bg-sky-100 text-sky-800 ring-sky-200',
  fixed: 'bg-amber-100 text-amber-900 ring-amber-200',
}

export const RELEASES: Release[] = [
  {
    on: '2026-09-09',
    headline: 'A to-do list, costs on a sale, and this page',
    changes: [
      {
        kind: 'new',
        text: 'A to-do list, behind the tick-box in the top bar. Tasks can be left for anyone to pick up, or handed to one of you, and can be raised from any part, sale or car so they carry what they are about. Dated ones show on the pickup schedule.',
      },
      {
        kind: 'new',
        text: 'Costs can now be recorded against a sale, with whoever actually paid them. If one of you collects the money and the other buys the postage, the settle-up hands the postage back and splits the cost properly instead of leaving one of you out of pocket.',
      },
      {
        kind: 'new',
        text: 'The parts page has a table view that drops the photos and fits far more on a screen. Whichever view you used last is what you get next time.',
      },
      {
        kind: 'new',
        text: 'This page, linked at the bottom of every screen.',
      },
      {
        kind: 'better',
        text: 'The parts page shows what you still have by default. Sold and scrapped parts sit behind "Everything, sold included", the same way voided sales do.',
      },
      {
        kind: 'better',
        text: 'A part’s status can be changed straight from its page, and the entry form has a "Ready to sell" tick, so getting something out of draft is one click rather than four.',
      },
      {
        kind: 'fixed',
        text: 'The app could keep running old code after a deploy. The page that names everything else was allowed to sit in the browser cache, and because the version on screen comes from the server rather than the code, it looked updated while it was not.',
      },
      {
        kind: 'fixed',
        text: 'A sale wrongly marked paid or collected can be put back. There was previously no way to undo either.',
      },
      {
        kind: 'fixed',
        text: 'Two releases pushed close together could carry the same version number, so the number shown did not reliably identify what was running.',
      },
    ],
  },
  {
    on: '2026-09-08',
    headline: 'Where a part is advertised',
    changes: [
      {
        kind: 'new',
        text: 'Each part records where it is listed — the marketplace, the account it was posted under, and a link to the advert. Cross-posted parts get a row each.',
      },
      {
        kind: 'new',
        text: 'The home page flags adverts still live for parts that have sold or been scrapped, so you can take them down before the messages start.',
      },
    ],
  },
  {
    on: '2026-09-04',
    headline: 'A history of who changed what',
    changes: [
      {
        kind: 'new',
        text: 'Every sale, part and car keeps a History panel: who created it, who changed it, and what each field said before. Both of you can read it.',
      },
      {
        kind: 'better',
        text: 'Voiding a sale no longer deletes it. It is kept and marked voided, with who cancelled it and why, and hidden from the list unless you ask. A sale that simply vanished left no way to tell whether a payment had ever been recorded.',
      },
      {
        kind: 'new',
        text: 'A settlement can be any amount, not only the exact figure the report worked out. Part payments and round numbers are just as common.',
      },
      {
        kind: 'fixed',
        text: 'Taking a second photo when adding a part no longer throws the first one away, and several can be picked from your library at once.',
      },
    ],
  },
  {
    on: '2026-09-04',
    headline: 'A shorter sale form, and selling straight from a part',
    changes: [
      {
        kind: 'better',
        text: 'Recording a sale is about a third shorter on a phone, and the button to save it is always on screen. Shipping, fees and tax fold away, having never once been used.',
      },
      {
        kind: 'new',
        text: '"Sell this" on any part, and on the parts page you can tick several and sell them together as one lot.',
      },
      {
        kind: 'new',
        text: 'The app has its own icon, so it installs on a phone home screen properly rather than as a blank square.',
      },
    ],
  },
  {
    on: '2026-09-04',
    headline: 'Type-ahead, and every line behind the summary',
    changes: [
      {
        kind: 'new',
        text: 'Buyer, scrap yard and part-name fields suggest what you have typed before, commonest first, so the same item keeps the same name.',
      },
      {
        kind: 'new',
        text: 'Money has an "Every line" tab: one row per sale line, cost and settlement, filterable and exportable. The column adds up to the profit at the top, so the summary can be checked rather than trusted.',
      },
      {
        kind: 'fixed',
        text: 'The Money page counted unpaid sales towards a car’s income while the car’s own page did not, so the two disagreed. They now match, and the page explains why per-car figures never sum exactly to the venture total.',
      },
    ],
  },
  {
    on: '2026-09-04',
    headline: 'Scrap sales, fixed',
    changes: [
      {
        kind: 'fixed',
        text: 'Scrap payments recorded from a car’s page were not counted as scrap, did not mark the car scrapped, sat as unpaid forever, and could be entered twice. All four came from one omission.',
      },
      {
        kind: 'new',
        text: 'A car’s page shows what it earned as well as what it cost. Showing only the spending made every car read as a pure loss.',
      },
    ],
  },
  {
    on: '2026-09-04',
    headline: 'Pickup times and a schedule',
    changes: [
      {
        kind: 'new',
        text: 'A sale records when the buyer is coming, and Sales has a Pickup schedule tab grouping everything still to hand over by day. Anything whose time has passed without being marked collected is pulled to the top in red.',
      },
      {
        kind: 'new',
        text: 'Each pickup shows which site the parts are stored at, worked out from where they live.',
      },
    ],
  },
  {
    on: '2026-09-01',
    headline: 'Sales that are agreed but not finished',
    changes: [
      {
        kind: 'new',
        text: 'A sale tracks payment and handover separately: agreed, paid, gone, or done. Money counts on the day it lands, not the day the deal was struck, so a sale you are still owed for cannot change who owes whom.',
      },
      {
        kind: 'better',
        text: 'Parts on an agreed sale are held rather than sold, and stop being offered to anyone else.',
      },
    ],
  },
  {
    on: '2026-09-01',
    headline: 'Per-car profit, and a manual',
    changes: [
      {
        kind: 'new',
        text: 'The Money page shows how each car has done side by side — spent, taken, scrap, profit.',
      },
      {
        kind: 'new',
        text: 'Costs that belong to no car — food, consumables, tools — have their own section. They count in the split but stay out of any car’s profit.',
      },
      { kind: 'new', text: 'An in-app manual, behind the question mark in the top bar.' },
      { kind: 'new', text: 'A System panel in Settings showing what the install is holding.' },
    ],
  },
  {
    on: '2026-09-01',
    headline: 'Lot sales, scrapping, and better part numbers',
    changes: [
      {
        kind: 'new',
        text: 'A whole lot can be sold on one line at one price instead of pricing every piece, and a line can be a scrapped shell.',
      },
      {
        kind: 'new',
        text: 'Marking a car scrapped asks what the yard paid, or what it charged to take it away.',
      },
      {
        kind: 'better',
        text: 'Part numbers are read from photos at several sizes, which finds stickers that filled only a small part of the frame.',
      },
      {
        kind: 'new',
        text: 'Cars can have a nickname, and a VIN can be recorded as genuinely unknown rather than just blank.',
      },
    ],
  },
]
