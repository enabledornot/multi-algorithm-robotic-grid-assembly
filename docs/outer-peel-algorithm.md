# Outer Peel Algorithm — Pseudocode

This document describes the outer peel algorithm as currently implemented
(`src/outerPeel.js`), independent of the specific data structures and
language used to implement it. It is meant to capture *behavior*, including
the non-obvious fixes accumulated through debugging, not to mirror the code
line for line.

## Goal

Given a 2D shape made of grid cells (a polyomino), produce an ordered
sequence in which the cells can be removed — equivalently, the reverse order
in which a robot could build the shape one cell at a time, always adding a
cell that is currently reachable from the outside. The algorithm works by
repeatedly identifying the shape's outer boundary and peeling material off
it: corners first, then dead-end appendages ("tails"), continuing inward
until no more progress can be made.

It does **not** yet fully resolve every shape. Regions that are neither a
clean two-neighbor turn nor a one-neighbor dead end — solid interior blocks,
or junctions where three or more directions are all part of the shape — are
a known, current limitation. The algorithm stops there and reports whatever
remains unresolved; see "Known limitations" at the end.


## Data model (conceptual, not a specific struct layout)

- The shape is a grid of **cells**. Each cell knows its four grid neighbors
  (north/east/south/west), each of which is either another cell or "nothing"
  (off the edge of the shape, or removed).
- Every cell carries:
  - **removed** — has this cell been taken out of the shape yet?
  - **walked count** — how many times has a boundary walk passed through
    this cell, capped at 2. `0` = never touched by any walk. `1` = touched
    exactly once so far, so it currently reads as a simple boundary cell.
    `2` = touched a second time, which reclassifies it as a "bridge" cell
    (see below) — the count is never tracked past 2, because nothing past
    that distinction matters.
  - **cycle id** — which labeled boundary loop this cell currently belongs
    to, once it has been classified (see phase 3).
- A **cycle** is a discovered closed boundary loop. Each one owns a growing
  list of "corner" cells found on it so far (see phase 3) and, conceptually,
  an active/inactive status (not currently used to change behavior — see
  Known limitations).
- A **corner record**, once a corner is found, stores: the corner cell
  itself, its two active neighbors at the moment it was found (labeled
  *predecessor* and *successor*, in the direction the walk was moving), the
  cycle it belongs to, and the direction the walk was moving when it arrived
  at the corner (needed later to resume walking from this exact spot with
  the correct orientation — see phase 4).
- A global **corner worklist** collects every corner record found, across
  every cycle — not just each cycle's own list — because a cycle made
  entirely of straight edges and bridge cells can otherwise end up with no
  corners of its own to peel from.


## Direction convention

Four compass directions, indexed 0–3: **0 = north, 1 = east, 2 = south, 3 =
west**. Note that this ordering increases *clockwise*. Two facts about this
indexing get used constantly:

- Turning 90° clockwise from a direction = `(direction + 1) mod 4`.
- The reverse of a direction = `(direction + 2) mod 4`.

Every walk needs one known point that is definitely "outside" the shape,
adjacent to wherever it's starting. From that point, the walk derives an
initial **outside-direction** value: the compass direction, relative to the
start cell, in which that known-exterior point lies.

At every step, given the current outside-direction, the four possible move
directions are tried in this priority order (all mod 4, relative to
outside-direction `o`):

```
priority = [ o+2,  o+3,  o,  o+1 ]
             |     |     |    |
             |     |     |    +-- reverse of forward (last resort)
             |     |     +------- same as outside-direction
             |     +------------- "forward" (90° counter-clockwise from outside)
             +------------------- sharpest available clockwise turn (tried first)
```

This is a wall-following rule: always prefer the tightest clockwise turn
that's actually available, falling back toward "straight ahead" and finally
"reverse" only if tighter options don't exist. This is what makes the walk
hug the true outer boundary of the shape, including hugging convex corners
tightly, without needing to know the shape's geometry in advance.

Whenever a move is taken in some direction `d`, the new outside-direction
becomes `(d + 1) mod 4` — the exterior is always 90° clockwise from the
direction just walked.


## Top-level flow

```
run(shape):
    reset all algorithm state
    build the adjacency grid from the input shape        (phase 1)
    if the grid is empty: stop

    pick cells[0] (see phase 1 for why this is always a safe start) and the
    exterior point immediately to its left as the walk's starting reference

    walk the full outer boundary once, marking walked counts and
    removing any dead-end tails found along the way                 (phase 2)

    find the first surviving (non-removed) cell reachable from cells[0]
    by following the boundary path — this skips over anything phase 2
    already removed — and use it to run one full cycle/corner-labeling
    walk, seeded with cycle id 0                                     (phase 3)

    repeat until neither step makes further progress:
        drain the corner worklist, peeling one corner at a time      (phase 4)
        sweep for orphaned fragments and clean them up               (phase 5)

    return the final shape state and the ordered removal sequence
```

The repeat-until-stable loop exists because draining corners and cleaning up
orphaned fragments can each trigger more work for the other: peeling a
corner can strand some other part of the shape as a side effect (phase 5
exists specifically to catch that), and cleaning up a stranded fragment can
surface brand new corners to peel (which then need draining again).


## Phase 1 — Build the adjacency grid

Turn the input matrix into a flat collection of cells with direct neighbor
links, in two passes:

```
build_grid(matrix):
    # Pass 1 — vertical links, scanning column by column
    for each column, top to bottom:
        for each occupied cell in the column, in row order:
            create a cell for it
            if the previous occupied cell in this same column was exactly
            one row above: link them north/south to each other

    # Pass 2 — horizontal links, one linear scan over all created cells
    #   in the same column-major order they were created
    remember, per row, "the last cell seen at this row height" (start empty)
    for each cell, in creation order:
        if the remembered cell at this row is immediately to this cell's
        left (its column is exactly one less): link them east/west
        update "the last cell seen at this row height" to this cell
```

Cells are created in column-major order (leftmost column first, top to
bottom within each column). This guarantees that **cell 0 is always the
topmost cell of the leftmost occupied column** — which means cell 0's west
side and north side are *always* genuinely outside the shape, with no need
to inspect the shape to confirm it. This is exactly the "one known exterior
point" every walk needs to bootstrap its orientation, so cell 0 (with the
point just west of it) is used as the universal starting reference.


## Phase 2 — Full boundary walk: mark visits, remove tails inline

This is the very first walk over the (completely untouched) shape. It has
two jobs at once: mark how many times each cell gets visited, and — inline,
as it goes — detect and remove any dead-end appendages ("tails") it walks
into. It always runs as a single full loop, starting and ending at the same
cell.

```
walk_and_remove_tails(start_cell, start_outside_point):
    outside_direction = direction from start_cell toward start_outside_point
    current = start_cell
    bump current's walked count (capped at 2); record the visit visually

    pending_tail = none          # a turnaround point awaiting resolution
    entry_direction = none       # which direction we most recently moved in
    first_move_direction = none
    first_step_target = none

    loop (bounded by a generous step limit):
        try candidate directions at `current`, in priority order:
            skip a candidate that leads off the shape or to an
            already-removed cell

            # Closing the loop
            if this is a full loop, we've moved before, and this candidate
            would retake the very first step from start_cell:
                if a tail is still pending, resolve it now (see handle_tail)
                stop — the walk is complete

            # Turnaround: about to step back the exact way we came
            if this candidate is the reverse of entry_direction:
                bump current's walked count again (capped at 2); redraw it
                remember current as a new pending tail, along with the
                neighbor on its boundary side (the direction opposite this
                reversal) — that neighbor is where resolving the tail should
                walk back toward once it's done

            # A pending tail resolves once the walk has clearly returned to
            # already-established territory — detected the moment the next
            # cell's walked count isn't already exactly 1
            if a tail is pending and the candidate cell's walked count != 1:
                resolve the pending tail (see handle_tail)
                if resolving it also consumed the candidate cell itself
                (its own inward chain reached that far): treat this
                candidate as gone too, and try the next one instead —
                stepping onto a cell that was just removed would
                incorrectly re-mark it as visited again

            update outside_direction for the new position
            record first_move_direction / first_step_target if this is the
            first move taken
            entry_direction = this move's direction
            move current to the candidate cell

            if we're back at start_cell:
                if this return is from the same side we originally left
                (a same-side return): bump its walked count again, and
                remember to treat start_cell itself as a tail tip once the
                walk ends
            else:
                bump current's walked count (capped at 2); redraw it
                if this is a bounded (not full-loop) walk and we've reached
                the target cell: stop

            move on to the next iteration

        if no candidate at all could be taken this iteration (every
        direction was off the shape or already removed — this happens for a
        cell with zero remaining active neighbors, which can never trigger
        the reversal-detection above because that requires having tried a
        candidate at all):
            resolve current itself as a tail (see handle_tail) and stop

    # Cleanup once the loop exits
    if a tail is still pending: resolve it
    if start_cell was confirmed to be a tail tip (same-side return):
        resolve it too, walking back toward the boundary-side neighbor
        recorded when the return was detected
```

### Sub-procedure: resolve a tail

Given a cell suspected of being (or leading to) a dead-end appendage, follow
it inward one cell at a time, removing cells that are confirmed to be part
of the tail, until reaching either a genuine dead end or real boundary
structure.

```
handle_tail(tip_cell, ...):
    if tip_cell is already removed: stop — nothing to do (this can happen
    if an earlier resolution already consumed it)

    previous = none
    current = tip_cell

    loop:
        forward_options = current's neighbors, excluding `previous` and
                           excluding anything already removed

        if forward_options is empty:
            # a true isolated dead end
            remove current
            stop

        if current's walked count < 2, OR forward_options has more than
        one entry:
            # either this is actually a legitimate once-walked boundary
            # cell (not a tail after all), or it's a junction where the
            # tail meets multiple live paths — either way, stop without
            # removing it
            if current's walked count was artificially bumped to 2 or more
            by the outer walk re-entering it while exiting the tail:
                undo that extra bump, restoring its true walked count
            stop

        # exactly one forward option, and this cell has genuinely been
        # visited twice — it's confirmed tail material
        remove current
        previous = current
        current = forward_options[0]
```


## Phase 3 — Cycle & corner labeling walk

Once phase 2 has established walked counts (and pruned tails) across the
whole shape, this walk assigns each surviving cell to a labeled cycle and
records every convex corner it passes. It shares the same wall-following
mechanics as phase 2, but does not modify walked counts by default — it
assumes phase 2 already finished, and just reads what phase 2 recorded.

(This same procedure gets reused later, in phases 4 and 5, for walks that
*do* need to actively establish walked counts as they go — see "Two modes"
below.)

Terminology used here:
- **Cycle cell** — walked count is exactly 1 (a plain, once-visited
  boundary cell). Gets labeled with a cycle id.
- **Bridge cell** — walked count is exactly 2 (visited a second time).
  Acts as a connector between cycle segments rather than a genuine boundary
  vertex; does not get its own cycle id, except that the *first* bridge
  cell entered from a given cycle keeps that cycle's id stamped on it, so
  the walk can restore the right context when it re-emerges from the bridge
  later.

```
walk_and_label(start_cell, target_cell, start_outside_point,
               starting_cycle_id, inherited_entry_direction = none):

    outside_direction = direction from start_cell toward start_outside_point
    current_cycle_id = starting_cycle_id
    next_free_cycle_id = starting_cycle_id + 1
    ensure a cycle record exists for current_cycle_id

    if start_cell's walked count is exactly 1:
        label start_cell with current_cycle_id

    entry_direction = inherited_entry_direction
    peel_continuation_mode = (inherited_entry_direction is not none)

    current = start_cell

    # If start_cell survived phase 2 but was never actually labeled (it's a
    # bridge cell, not a genuine cycle cell), take one preliminary step to
    # its first live neighbor before the main loop begins, so the rest of
    # the logic doesn't need extra special-casing for this situation.
    if start_cell is not removed and has no cycle id yet:
        try candidates at start_cell in priority order; take the first
        live one as a pre-step, updating outside_direction, entry_direction,
        and current accordingly

    loop (bounded by a generous step limit):
        try candidate directions at `current`, in priority order:
            skip a candidate that leads off the shape or to an
            already-removed cell

            if this is a full loop, we've moved before, and this candidate
            would retake the very first step from start_cell:
                check whether `current` (i.e. start_cell) is itself a
                corner (see below) — this is its only chance, since it
                never gets a normal turn of its own once the loop is
                about to close
                stop — the walk is complete

            check_for_corner(current, this candidate direction)   # below

            # Cycle → bridge: if we're leaving a plain cycle cell and
            # stepping onto an already-established bridge cell, stamp that
            # bridge cell with current_cycle_id — read back later on the
            # way out of the bridge
            if current is a cycle cell and the candidate is a bridge cell:
                stamp the candidate with current_cycle_id

            # Bridge → cycle: if we're leaving a bridge cell and stepping
            # onto a plain cycle cell, restore the right cycle context:
            #   - if the bridge cell we're leaving carries a stamped id,
            #     restore that
            #   - else if the destination already has an id, reconnect to it
            #   - else this is a previously-unseen cycle: allocate a fresh id
            if current is a bridge cell and the candidate is a cycle cell:
                current_cycle_id = (whichever of the above applies)

            record whether this is the very first move away from
            start_cell (needed just below)

            update outside_direction for the new position
            entry_direction = this move's direction
            move current to the candidate cell

            if peel_continuation_mode and this was the first move away from
            start_cell and start_cell's walked count was exactly 1:
                # start_cell never gets a normal "arrival" of its own to
                # pick this up the way every other cell does below — it's
                # where the walk resumes, not something stepped onto. This
                # must happen only now, after check_for_corner above already
                # used its original walked count — bumping it any earlier
                # would prevent start_cell itself from ever being detected
                # as a new corner.
                bump start_cell's walked count to 2; redraw it as a bridge

            # Establish the walked count for whatever we just stepped onto.
            # In the normal (non-peel-continuation) case this cell was
            # already fully established by phase 2, so nothing here fires.
            # In peel-continuation mode, this walk IS what establishes it:
            if the candidate's walked count (before this arrival) was 0:
                set it to 1; redraw it as a once-walked cell
            else if peel_continuation_mode and it was exactly 1:
                # a second visit — this cell is becoming a bridge, exactly
                # as it would have if both visits happened in one
                # continuous walk
                set it to 2; redraw it as a bridge
                if current is (still) a plain cycle cell: stamp the
                candidate with current_cycle_id

            if the candidate's walked count is exactly 1 and it has no
            cycle id yet: label it with current_cycle_id

            if this is a bounded (not full-loop) walk and we've reached
            target_cell: stop

            move on to the next iteration

        if no candidate at all could be taken this iteration:
            # same situation as phase 2's dead end — reuse the same
            # tail-resolution procedure directly
            resolve current as a tail
            stop

    return next_free_cycle_id
```

### Sub-procedure: check for a corner

```
check_for_corner(cell, exit_direction):
    if entry_direction is none: return          # nothing to compare against yet
    if cell's walked count != 1: return          # only plain cycle cells qualify

    # A turn 90° clockwise from how we arrived is convex — the shape bulges
    # outward here, majority of the surrounding area is exterior. A turn
    # that keeps going straight (exit == entry) isn't a corner at all. A
    # turn 90° counter-clockwise (reflex/concave — a notch, not a bump) is
    # deliberately NOT treated as a corner.
    if exit_direction != (entry_direction + 1) mod 4: return

    predecessor = the neighbor in the reverse of entry_direction
                  (the cell the walk arrived from)

    # A genuine corner needs a real, still-active predecessor. In a normal
    # walk this is guaranteed (entry_direction always reflects a move just
    # taken, so the predecessor must exist). But cell's own entry_direction
    # can be an inherited/synthetic value (see phase 4), in which case this
    # check can genuinely fail — e.g. the cell turned out to be a dead end,
    # not a corner, once its neighbor was peeled away.
    if predecessor is none or predecessor is already removed: return

    successor = the neighbor in exit_direction (where the walk is heading)

    record a corner: { this cell, predecessor, successor, current_cycle_id,
                        entry_direction }
    add it to this cycle's corner list AND to the global corner worklist
    mark the cell visually as a corner
```

### Two modes

This procedure is called in two different situations, and they must be told
apart:

1. **The original full-shape walk** (phase 3 proper, `inherited_entry_direction
   = none`): every cell it will touch was already fully established by
   phase 2 — walked counts are already final. This mode must be read-only
   with respect to walked counts; if it treated an already-`1` cell as "a
   second visit happening right now," the entire shape would immediately
   look like one giant bridge.
2. **A peel's resumed walk** (phases 4/5, `inherited_entry_direction` given
   explicitly): this walk is what actively discovers newly exposed
   territory, so it must both establish fresh (`0 → 1`) cells and correctly
   promote already-`1` cells to bridges when it revisits them.

The same distinction is why `start_cell` needs an **inherited entry
direction** at all in mode 2, rather than starting fresh with none: without
it, `check_for_corner` could never evaluate start_cell's own first move
(there'd be nothing to compare it against), so a cell that has itself just
become a new corner as a direct result of the peel would silently be missed.


## Phase 4 — Peel corners one at a time

```
drain_corner_worklist():
    made_progress = false
    while the global corner worklist is not empty:
        take the next corner record off it

        # Entries can go stale: the corner cell, or either of its recorded
        # neighbors, may already be gone by the time this record is
        # reached — removed by some other peel in the meantime. A record
        # can also be a straight-up duplicate of one already handled. Both
        # are simply discarded rather than acted on. (A cell's set of still-
        # active neighbors only ever shrinks over time, since removals are
        # permanent — so if all three recorded cells are still present, the
        # record is still valid; no deeper geometric recheck is needed.)
        if the corner cell, its recorded predecessor, or its recorded
        successor has already been removed: discard this record, continue

        peel_one_corner(record)
        made_progress = true

    return made_progress


peel_one_corner(record):
    # Reuse the corner's own recorded orientation, turned 90° clockwise,
    # rather than deriving a fresh orientation from the predecessor cell's
    # own geometry. The predecessor can have its own unrelated exterior
    # sides (e.g. it might be sitting on the original edge of the whole
    # shape) — deriving orientation fresh from its position would pick up
    # on those instead, sending the walk off into unrelated interior
    # structure rather than forward through the newly exposed edge.
    resume_direction = (record.entry_direction + 1) mod 4
    resume_outside_point = the point one step from the predecessor cell,
                            in resume_direction

    remove the corner cell from the shape

    walk_and_label(record.predecessor, record.successor,
                    resume_outside_point, record.cycle_id,
                    inherited_entry_direction = record.entry_direction)
```

Removing a corner always exposes exactly two cells that were previously its
only neighbors (predecessor and successor) — each loses one of its own
neighbors as a direct result. The resumed walk starts at the predecessor
and tries to reach the successor; whatever it passes through along the way
(freshly exposed territory, or simply the rest of the old boundary if no
shortcut exists) gets correctly walked-counted and labeled, exactly as
phase 3 describes, including discovering brand new corners and dead ends as
it goes.


## Phase 5 — Clean up orphaned fragments

A cell can be perfectly, correctly connected at the exact moment a nearby
corner is peeled — and only become a stranded, disconnected dead end
*afterward*, purely as a side effect of some other, unrelated peel
elsewhere along the same path consuming the cells that used to connect it
onward. Nothing in phase 4 ever revisits an already-labeled cell to notice
that this happened to it. This phase exists specifically to find and
resolve those cases, by re-running the same two-step pipeline used for the
very first walk (phase 2 then phase 3) on each stranded fragment,
independently, as if it were its own small shape.

```
find_exterior_reference(cell):
    # Any side that's off the shape, or already removed, works as a valid
    # "outside" reference point — exactly the same idea phase 1 uses for
    # cell 0, just generalized to an arbitrary cell. A cell with no such
    # side at all is genuinely buried in the interior; nothing should be
    # starting a walk from it (yet).
    for each of the cell's four neighbor directions:
        if that neighbor is off the shape, or already removed:
            return the point one step from the cell in that direction
    return none


cleanup_orphaned_fragments():
    made_progress = false
    already_handled_this_pass = empty set

    for each cell in the shape, in a fixed order:
        if it's already removed, or already handled this pass: skip it

        exterior_point = find_exterior_reference(cell)
        if none: skip it — genuinely interior, nothing to walk from yet

        snapshot every cell's (walked count, removed?) state
        snapshot the current size of the corner worklist

        walk_and_remove_tails(cell, exterior_point)     # phase 2's procedure

        if cell was not removed by that:
            walk_and_label(cell, cell, exterior_point,
                            a freshly allocated cycle id)   # phase 3's procedure,
                                                             # full-loop mode

        # "Progress" must mean a real state change — something got removed,
        # or a new corner was queued — not merely "this fragment got walked
        # again." Once a fragment has fully stabilized, later calls would
        # otherwise keep re-walking it (harmlessly, since walked counts are
        # capped) while still reporting progress every time, which would
        # keep the outer repeat-until-stable loop running forever.
        if anything changed from removed=false to removed=true, or the
        corner worklist grew: made_progress = true

        mark every cell whose (walked count, removed?) actually changed as
        "handled this pass" (comparing against the snapshot) — this walk's
        effects can reach well beyond just `cell` itself, and re-starting a
        fresh walk from one of those already-covered cells later in this
        same sweep would be redundant

    return made_progress
```

Each fragment is given a **freshly allocated** cycle id rather than reusing
whatever cycle id its cells happened to carry from before — their old cycle
context doesn't mean anything once they've been cut off from the rest of
that cycle. (In practice, cells that are still reachable from an existing
cycle usually reconnect to that cycle's original id anyway, via the bridge
→ cycle logic in phase 3 — the freshly allocated id only actually gets used
when the fragment turns out to be genuinely disconnected from everything
else.)


## Known limitations

- **Junctions.** A cell with three or four active neighbors is neither a
  corner (exactly two, perpendicular) nor a tail tip (exactly one). Once
  peeling and tail-removal have stripped away everything else, clusters of
  interlocking junction cells — a solid interior block, or a "hub" where
  multiple loop-shaped sections of the same figure meet — are left behind
  untouched. This is a structural gap in what's implemented, not a bug:
  there is currently no strategy for making further progress on this kind
  of remainder.
- **Cycle `isActive` status** is tracked per cycle but not currently used to
  change any behavior.
- **Peel layer computation and summary statistics** are still stubs.
