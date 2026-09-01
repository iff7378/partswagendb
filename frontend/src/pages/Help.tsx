import { Link } from 'react-router-dom'

import { PageHeader } from '../components/ui'

/**
 * The manual. Written for the two people who run the yard, not for developers:
 * it explains what each screen is for and, where the app enforces something,
 * why — because a rule you do not understand reads as a bug.
 */
export default function Help() {
  return (
    <>
      <PageHeader title="How this works" subtitle="What each screen is for, and why" />

      <nav className="card mb-5 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Jump to
        </p>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="font-medium text-rust hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-5">
        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id} className="card scroll-mt-20 p-5">
            <h2 className="text-lg font-bold">{section.title}</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed">{section.body}</div>
          </section>
        ))}
      </div>
    </>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
      {children}
    </p>
  )
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  )
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

const SECTIONS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: 'shape',
    title: 'The shape of it',
    body: (
      <>
        <P>
          Everything here follows one loop: you buy a car, pull parts off it, put those parts on
          a shelf, sell them, and settle up with each other. Each screen covers one step.
        </P>
        <Bullets
          items={[
            <>
              <strong>Cars</strong> — the donor vehicles, what each cost, and what it has
              returned.
            </>,
            <>
              <strong>Parts</strong> — everything pulled off a car, where it lives and what it is
              worth.
            </>,
            <>
              <strong>Storage</strong> — the shelves and bins, each with a QR label you can scan.
            </>,
            <>
              <strong>Sales</strong> — what left, for how much, and who took the money.
            </>,
            <>
              <strong>Money</strong> — profit per car, shared costs, and who owes whom.
            </>,
          ]}
        />
        <P>
          The golden rule: <strong>money is only ever recorded once</strong>. Every pound in or
          out has a person attached to it, which is what makes the settle-up honest.
        </P>
      </>
    ),
  },
  {
    id: 'cars',
    title: 'Adding a car',
    body: (
      <>
        <Steps
          items={[
            <>
              <Link className="text-rust underline" to="/vehicles">
                Cars
              </Link>{' '}
              → <em>Add a car</em>. Type the VIN and hit <em>Decode</em> — the year, make, model
              and engine fill themselves in from the national database.
            </>,
            <>
              No readable VIN? Tick <em>VIN is unknown</em> so nobody goes out to check again.
              You can also photograph the door jamb or registration sticker and let it read the
              VIN off the picture.
            </>,
            <>
              Give it a <strong>nickname</strong>. That is what the car is called everywhere else
              in the app, so &ldquo;the silver wagon&rdquo; beats &ldquo;2011 Volkswagen Jetta
              SportWagen&rdquo;.
            </>,
            <>
              Record what you paid under <em>Record something you spent</em>, along with towing
              and anything else. Whoever actually paid gets picked here — that matters later.
            </>,
          ]}
        />
        <P>The four states a car moves through:</P>
        <Bullets
          items={[
            <>
              <strong>Acquired</strong> — bought, teardown not started.
            </>,
            <>
              <strong>In teardown</strong> — actively pulling parts.
            </>,
            <>
              <strong>Stripped</strong> — the good parts are out, the shell is still on the
              property.
            </>,
            <>
              <strong>Scrapped</strong> — the shell has gone to the yard.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'parts',
    title: 'Adding parts',
    body: (
      <>
        <P>
          <Link className="text-rust underline" to="/parts/new">
            Add a part
          </Link>{' '}
          is built for working through a whole car on your phone. The donor car and the shelf
          stay selected between saves, so use <em>Save &amp; add another</em> and keep going.
        </P>
        <P>
          Photograph the part number sticker if there is one. Part numbers are read off the
          photo automatically a few seconds after upload, and appear as tappable chips on the
          part&rsquo;s page — tap one to fill the field. It is not instant: a batch of twenty
          photos takes about a minute to work through.
        </P>
        <P>
          A part with a price, a shelf and a category is <strong>Available</strong>. Anything
          missing one of those is a <strong>Draft</strong> — still a real part on a real shelf,
          still sellable, just not finished. Drafts are normal and you do not have to clear them.
        </P>
        <P>
          <em>Flag it if unsold after</em> puts the part on the home page under &ldquo;Sitting
          too long&rdquo; once it has aged past the number of days you pick. Sixty days is the
          default and it remembers whatever you last chose.
        </P>
      </>
    ),
  },
  {
    id: 'finding',
    title: 'Finding things',
    body: (
      <>
        <P>
          The <Link className="text-rust underline" to="/parts">Parts</Link> page searches names,
          SKUs and part numbers, and filters by car, shelf, category, tag and condition.
        </P>
        <P>
          <strong>Missing</strong> narrows to one gap at a time — no photos, no part number, not
          on a shelf, no price. It is deliberately one thing rather than
          &ldquo;incomplete&rdquo;, because almost nothing is ever fully filled in and a filter
          that matches everything tells you nothing.
        </P>
        <P>
          <strong>Scan</strong> in the top bar reads the QR label on a shelf or a part. Scanning
          a part opens it; scanning a shelf while a part is open moves that part onto the shelf.
          Print labels from any part or storage place.
        </P>
      </>
    ),
  },
  {
    id: 'sales',
    title: 'Recording a sale',
    body: (
      <>
        <P>
          One sale can have as many lines as you need, and{' '}
          <strong>one line is whatever went for one price</strong>. There are three kinds:
        </P>
        <Bullets
          items={[
            <>
              <strong>Parts from stock</strong> — tick one part, or tick a dozen and sell them as
              a lot for a single negotiated price. Give the lot a name like &ldquo;entire
              interior&rdquo;. Everything you tick leaves stock.
            </>,
            <>
              <strong>The shell, for scrap</strong> — the car itself going to the yard. This is
              the only thing that marks a car scrapped.
            </>,
            <>
              <strong>Not itemised</strong> — something that was never catalogued as a part. Pick
              the car it came off so the money still lands against that car.
            </>,
          ]}
        />
        <P>
          <strong>Who took the money</strong> is the important field. It is what the settle-up
          report is built on.
        </P>
        <P>
          A sale tracks two things separately, because they rarely happen together:{' '}
          <strong>the money landing</strong> and <strong>the parts leaving</strong>. Tick both
          when you record it and the sale is done; leave either unticked and it sits in the list
          until you mark it. Use the buttons on the sale to move it along.
        </P>
        <Bullets
          items={[
            <>
              <strong>Agreed</strong> — someone has said yes. The parts are held for them but
              still on your shelf, and nothing has hit the books.
            </>,
            <>
              <strong>Paid, not collected</strong> — the money counts from the day it landed.
              The parts stay put until collection.
            </>,
            <>
              <strong>Gone, not paid</strong> — the parts have left. It does not count as income
              until you mark it paid.
            </>,
            <>
              <strong>Done</strong> — both.
            </>,
          ]}
        />
        <Note>
          Income counts on the day the money <em>landed</em>, not the day the deal was struck.
          A sale you are still owed for is not cash anyone is holding, so it cannot change who
          owes whom. The Sales page shows the outstanding total at the top.
        </Note>
        <Note>
          You cannot mark a part &ldquo;Sold&rdquo; by hand. Selling is what a sale record{' '}
          <em>is</em> — doing it by hand used to take parts out of stock with no money and no
          collector attached, which quietly lost income. Record the sale instead.
        </Note>
        <P>
          Got a sale wrong? Expand it and hit <em>Edit</em>. You can change the lines: parts you
          take off go back into stock, parts you add come out. Voiding is only for a sale that
          never happened.
        </P>
      </>
    ),
  },
  {
    id: 'scrapping',
    title: 'Scrapping a car',
    body: (
      <>
        <P>
          Set a car to <strong>Scrapped</strong> and it asks what happened to the shell, because
          nobody remembers to come back and record it later. Two answers:
        </P>
        <Bullets
          items={[
            <>
              <strong>The yard paid us</strong> — records a sale against that car, so the metal
              money counts towards what the car returned.
            </>,
            <>
              <strong>We paid to have it taken</strong> — records a disposal cost instead.
            </>,
          ]}
        />
        <P>
          If the cheque turns up a week later, the car&rsquo;s page keeps a{' '}
          <em>Record what the yard paid</em> button until you use it.
        </P>
      </>
    ),
  },
  {
    id: 'money',
    title: 'Money and settling up',
    body: (
      <>
        <P>
          The <Link className="text-rust underline" to="/money">Money</Link> page answers three
          questions.
        </P>
        <P>
          <strong>How is each car doing?</strong> What it cost against what it has returned,
          including scrap. Click through to any car for the detail.
        </P>
        <P>
          <strong>What did we spend that was not about one car?</strong> Food, cutting discs,
          tools. These count in the split but are kept out of every car&rsquo;s profit — one
          car should not look worse because someone bought lunch on the day it was stripped.
        </P>
        <P>
          <strong>Who owes whom?</strong> Each partner is entitled to their share of the profit.
          The report compares what they are actually holding — money collected, less money they
          laid out — against that, and lists the smallest set of transfers that levels everyone
          up. Make the transfers, then record them so the next period starts clean.
        </P>
        <P>
          Defaults to the current calendar quarter. Change the dates for any other period.
        </P>
      </>
    ),
  },
  {
    id: 'gotchas',
    title: 'Things that surprise people',
    body: (
      <Bullets
        items={[
          <>
            <strong>Drafts are fine.</strong> They are not errors. A part only needs a price, a
            shelf and a category to count as ready to list.
          </>,
          <>
            <strong>Part numbers take a few seconds.</strong> Reading happens in the background
            after upload. Reload the part if the chips have not appeared yet, or use{' '}
            <em>Try reading again</em>.
          </>,
          <>
            <strong>A shell can only be scrapped once.</strong> If a car is missing from the
            scrap list, it has already been weighed in.
          </>,
          <>
            <strong>A car is only marked scrapped once the shell has actually gone.</strong>{' '}
            Agreeing a price with the yard is not the same as it leaving the property.
          </>,
          <>
            <strong>Parts on an unpaid sale do not show in the picker.</strong> They are
            reserved for that buyer. Void or edit that sale to free them.
          </>,
          <>
            <strong>Per-car profit will not add up to the venture&rsquo;s profit.</strong> Shared
            costs sit outside the cars on purpose.
          </>,
          <>
            <strong>Deleting a car keeps its sales.</strong> The sale record survives with its
            description, so settled history never changes underneath you.
          </>,
        ]}
      />
    ),
  },
  {
    id: 'roles',
    title: 'Who can do what',
    body: (
      <Bullets
        items={[
          <>
            <strong>Admin</strong> — everything, plus managing people, categories and the system
            page.
          </>,
          <>
            <strong>Staff</strong> — add and edit inventory, record sales and costs.
          </>,
          <>
            <strong>Viewer</strong> — read only.
          </>,
          <>
            Only partners appear in the settle-up split. Someone can be an admin without being a
            partner, which is how a helper account stays out of the money.
          </>,
        ]}
      />
    ),
  },
]
