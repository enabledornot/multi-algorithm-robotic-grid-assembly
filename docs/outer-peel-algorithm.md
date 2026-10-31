# Outer Peel Algorithm

The outer peel algorithm removes exposed leaves, then safe corners, while
maintaining a non-singular cell graph. A singular 2x2 block is one whose only
occupied cells are a diagonal pair.

## Cell states and peel rules

- A **leaf** has degree zero or one in the active orthogonal cell graph, and
  all of its missing sides have been reached by the exterior perimeter walk.
  Accessible leaves are always processed before corner candidates; leaves in
  an enclosed cavity wait until a pair peel opens that cavity.
- A **corner candidate** has degree two, perpendicular active neighbors, and
  both other sides on the explored exterior perimeter.
- A corner is **closed** when the opposite diagonal cell completes its 2x2
  block. It can be removed as a single-cell peel if the local singularity check
  passes.
- A corner is **opening** when that diagonal cell is absent. It can be removed
  with one of its directly adjacent degree-two cells that has an explored
  outside side. Both cells are committed as one pair peel, after a local check
  that the result has no diagonal-only 2x2 block.

If leaves appear while processing safe candidates, the leaf queue takes
priority again. Queue entries carry cell revisions; local changes invalidate
old entries without searching or rebuilding either queue.

## Directed perimeter walk

The perimeter walker stores oriented cell sides. Each side is directed so the
occupied cell lies on its right. The initial walk starts on an exposed side of
the first occupied cell. A pair peel exposes sides adjacent to the removed
cells; each newly accessible side starts or joins a continuation walk. A side
of an enclosed region may be geometrically exposed earlier, but is not marked
as explored until the region connects to the exterior. At each grid vertex,
the walker follows the boundary with right-turn, straight, left, then reverse
priority. It stops when it reaches a previously explored side.

Explored sides represent exterior reachability. Empty regions that were
enclosed are not explored until a pair peel opens them to the exterior. On
opening, the continuation walks trace their newly accessible perimeter; no
grid flood fill is used.

## Local updates and complexity

A peel changes the active degree and diagonal pattern only within the 8-cell
neighborhood of its removed cells. Those cells are reclassified and their
revision-checked candidate records are appended to the queues. Each cell is
removed at most once, each removal causes a constant number of local updates,
and each newly accessible oriented perimeter side is explored once. Perimeter
walks stop at known sides rather than rescanning known boundary sections.

Thus, after reading the input matrix, the algorithm performs O(n) work and
uses O(n) storage for n occupied cells, provided the boundary continuation
hits a known side in constant-time through its local vertex lookup. Input
materialization itself is O(RC) for an R-by-C boolean matrix. Inputs containing
a diagonal-only 2x2 block are rejected before peeling begins.

Pair peels are emitted as a single `updateCells` event, so animation playback
never displays a state in which only one member of a pair has been removed.
The returned `peelGroups` also preserves simultaneous pair membership when
consumers need to distinguish it from the flattened `buildOrder`.

## Animation levels

The selector is ordered from most detailed to most grouped. In Outer Peel
mode the choices are:

1. **Every Step** — each perimeter-side mark, color change, and removal event.
2. **Skip Perimeter Walk** — keeps other events while hiding per-side walk
   strokes.
3. **Group Leaf Removals** — shows the initial perimeter walk, then groups
   each complete leaf-draining batch into one frame; safe peels remain separate.
4. **Perimeter Walk Stages** — checkpoints the initial perimeter and pair-peel
   openings, grouping each newly accessible perimeter traversal into a frame.

Wavefront Sweep keeps its existing names in the same detail order: Full, Edge,
Component, and Wavefront.
