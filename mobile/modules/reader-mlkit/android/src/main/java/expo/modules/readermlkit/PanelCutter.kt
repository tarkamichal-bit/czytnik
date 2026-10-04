package expo.modules.readermlkit

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Finds comic panels in a grayscale page photo with a recursive XY-cut: the page is split along
 * light gutters (rows/columns that are almost entirely paper), first into horizontal strips, then
 * each strip into columns, and so on. The output order is the Western reading order
 * (top to bottom, left to right). Pure Kotlin, no Android types, so it can be unit-tested on the JVM.
 *
 * Phone photos are rarely perfect, so before cutting the page is
 *  - thresholded against the local paper brightness (shadows and uneven light), and
 *  - straightened: the small rotation (up to ±4°) that makes the gutters most straight is undone.
 */
object PanelCutter {
  /** Returns panels as [x0, y0, x1, y1] (x1/y1 exclusive) in the input's pixel space.
   *  texts: boxes of recognised text ([x0, y0, x1, y1]); their speech bubbles are treated as paper,
   *  so a bubble drawn across a gutter does not glue two panels together. */
  fun cut(lum: IntArray, w: Int, h: Int, texts: List<IntArray> = emptyList()): List<IntArray> {
    if (w < 8 || h < 8) return listOf(intArrayOf(0, 0, w, h))
    val light0 = lightMap(lum, w, h)
    clearBubbles(light0, w, h, texts)
    val angle = skew(light0, w, h)
    val light = if (angle == 0.0) light0 else rotate(light0, w, h, angle)

    // Regions are pixel masks (label = region id), so a cut may run along a slightly slanted
    // gutter (a phone photo is rarely square-on: perspective makes gutters converge).
    // The photo usually shows some table around the page: only the page (the hull of the paper) takes part.
    val label = pageMask(light, w, h)
    val longest = max(w, h)
    val frameLen = max(24, (longest * 0.1).toInt())
    val cx = Cutter(light, w, h, label, frameRuns(light, w, h, frameLen, vertical = true), frameRuns(light, w, h, frameLen, vertical = false))
    val minGap = max(3, (longest * 0.006).toInt())
    val out = mutableListOf<IntArray>()
    val all = bboxOf(label, w, h, 0) ?: intArrayOf(0, 0, w, h)
    cx.split(0, all, horizontal = true, depth = 0, minGap = minGap, out = out)

    val pageArea = (all[2] - all[0]).toLong() * (all[3] - all[1])
    val kept = out.filter { (it[2] - it[0]).toLong() * (it[3] - it[1]) >= pageArea * 0.02 }
    val boxes = if (kept.isEmpty()) listOf(all) else kept
    return if (angle == 0.0) boxes else boxes.map { unrotate(it, w, h, angle) }
  }

  /** Marks each text's bubble as paper: the light area around the text is flood-filled; when it stays
   *  enclosed (a bubble or a caption box), it is cleared together with its outline. Otherwise (an outline
   *  with a gap, or text on artwork) the oval a bubble around that text would take is cleared. */
  internal fun clearBubbles(light: BooleanArray, w: Int, h: Int, texts: List<IntArray>) {
    val ring = max(2, (max(w, h) * 0.006).roundToInt()) + 1
    val seen = IntArray(w * h)
    val queue = IntArray(w * h)
    var stamp = 0
    for (t in texts) {
      val tx0 = t[0].coerceIn(0, w - 1); val ty0 = t[1].coerceIn(0, h - 1)
      val tx1 = t[2].coerceIn(tx0 + 1, w); val ty1 = t[3].coerceIn(ty0 + 1, h)
      val m = max(tx1 - tx0, ty1 - ty0)
      val lx0 = max(0, tx0 - m); val ly0 = max(0, ty0 - m); val lx1 = min(w, tx1 + m); val ly1 = min(h, ty1 + m)
      stamp++
      var qh = 0; var qt = 0
      // a thin outline may have pinholes: walk only on paper that has paper on all four sides
      fun free(i: Int): Boolean {
        val x = i % w; val y = i / w
        return x > 0 && y > 0 && x < w - 1 && y < h - 1 && light[i] && light[i - 1] && light[i + 1] && light[i - w] && light[i + w]
      }
      for (y in ty0 until ty1) for (x in tx0 until tx1) {
        val i = y * w + x
        if (seen[i] != stamp && free(i)) { seen[i] = stamp; queue[qt++] = i }
      }
      var leaked = false
      while (qh < qt) {
        val i = queue[qh++]
        val x = i % w; val y = i / w
        if (x <= lx0 || y <= ly0 || x >= lx1 - 1 || y >= ly1 - 1) { leaked = true; break }
        for (n in intArrayOf(i - 1, i + 1, i - w, i + w)) if (seen[n] != stamp && free(n)) { seen[n] = stamp; queue[qt++] = n }
      }
      if (leaked || qt == 0) {
        // no closed outline found (a gap, or no bubble at all): clear the oval a bubble around this text would have
        val cx = (tx0 + tx1) / 2.0; val cy = (ty0 + ty1) / 2.0
        val rx = (tx1 - tx0) * 0.5 * 1.45 + ring * 2; val ry = (ty1 - ty0) * 0.5 * 1.6 + ring * 2
        for (y in max(0, (cy - ry).toInt())..min(h - 1, (cy + ry).toInt())) for (x in max(0, (cx - rx).toInt())..min(w - 1, (cx + rx).toInt())) {
          val dx = (x - cx) / rx; val dy = (y - cy) / ry
          if (dx * dx + dy * dy <= 1.0) light[y * w + x] = true
        }
        for (y in ty0 until ty1) for (x in tx0 until tx1) light[y * w + x] = true
        continue
      }
      // the bubble: the box around the filled area and the text, widened by the outline. (Letters and
      // a grainy print break the fill into patches, so the whole box is cleared, not just the fill.)
      var bx0 = tx0; var by0 = ty0; var bx1 = tx1 - 1; var by1 = ty1 - 1
      for (k in 0 until qt) {
        val x = queue[k] % w; val y = queue[k] / w
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y
      }
      for (y in max(0, by0 - ring)..min(h - 1, by1 + ring)) for (x in max(0, bx0 - ring)..min(w - 1, bx1 + ring)) light[y * w + x] = true
    }
  }

  private fun bboxOf(label: IntArray, w: Int, h: Int, id: Int): IntArray? {
    var x0 = w; var y0 = h; var x1 = -1; var y1 = -1
    for (y in 0 until h) for (x in 0 until w) if (label[y * w + x] == id) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
    return if (x1 < 0) null else intArrayOf(x0, y0, x1 + 1, y1 + 1)
  }

  /** Label 0 for pixels on the page, -1 for the table around it. The page is the convex hull of the
   *  largest connected patch of plain paper (margins and gutters are connected, also diagonally); a textured or dark
   *  table is not plain paper. When no such patch is found, the whole photo counts. */
  internal fun pageMask(light: BooleanArray, w: Int, h: Int): IntArray {
    val label = IntArray(w * h)
    val cell = max(3, max(w, h) / 80)
    val cw = (w + cell - 1) / cell; val ch = (h + cell - 1) / cell
    val paper = BooleanArray(cw * ch) { i ->
      val gx = i % cw; val gy = i / cw
      var n = 0; var l = 0
      for (y in gy * cell until min(h, (gy + 1) * cell)) for (x in gx * cell until min(w, (gx + 1) * cell)) { n++; if (light[y * w + x]) l++ }
      l >= n * 0.97
    }
    // largest 8-connected patch of paper cells
    val comp = IntArray(cw * ch) { -1 }
    var best = -1; var bestSize = 0; var id = 0
    val stack = IntArray(cw * ch)
    for (i in 0 until cw * ch) if (paper[i] && comp[i] < 0) {
      var sp = 0; stack[sp++] = i; comp[i] = id; var size = 0
      while (sp > 0) {
        val c = stack[--sp]; size++
        val gx = c % cw; val gy = c / cw
        for (dy in -1..1) for (dx in -1..1) {
          val nx = gx + dx; val ny = gy + dy
          if (nx !in 0 until cw || ny !in 0 until ch) continue
          val n = ny * cw + nx
          if (paper[n] && comp[n] < 0) { comp[n] = id; stack[sp++] = n }
        }
      }
      if (size > bestSize) { bestSize = size; best = id }
      id++
    }
    if (bestSize < cw * ch * 0.02) return label
    // convex hull (monotone chain) of the patch's cell corners
    val pts = mutableListOf<Pair<Int, Int>>()
    for (i in 0 until cw * ch) if (comp[i] == best) {
      val x0 = (i % cw) * cell; val y0 = (i / cw) * cell
      val x1 = min(w, x0 + cell); val y1 = min(h, y0 + cell)
      pts.add(x0 to y0); pts.add(x1 to y0); pts.add(x0 to y1); pts.add(x1 to y1)
    }
    val sorted = pts.distinct().sortedWith(compareBy({ it.first }, { it.second }))
    fun cross(o: Pair<Int, Int>, a: Pair<Int, Int>, b: Pair<Int, Int>) =
      (a.first - o.first).toLong() * (b.second - o.second) - (a.second - o.second).toLong() * (b.first - o.first)
    val hull = ArrayList<Pair<Int, Int>>()
    for (p in sorted) { while (hull.size >= 2 && cross(hull[hull.size - 2], hull[hull.size - 1], p) <= 0) hull.removeAt(hull.size - 1); hull.add(p) }
    val lower = hull.size + 1
    for (p in sorted.asReversed().drop(1)) { while (hull.size >= lower && cross(hull[hull.size - 2], hull[hull.size - 1], p) <= 0) hull.removeAt(hull.size - 1); hull.add(p) }
    hull.removeAt(hull.size - 1)
    if (hull.size < 3) return label
    // fill: each row of a convex polygon is one span
    for (y in 0 until h) {
      val yy = y + 0.5
      var lo = Double.MAX_VALUE; var hi = -Double.MAX_VALUE
      for (k in hull.indices) {
        val a = hull[k]; val b = hull[(k + 1) % hull.size]
        val ay = a.second.toDouble(); val by = b.second.toDouble()
        if ((yy < ay) == (yy < by)) continue
        val x = a.first + (yy - ay) / (by - ay) * (b.first - a.first)
        lo = min(lo, x); hi = max(hi, x)
      }
      for (x in 0 until w) if (x + 0.5 < lo || x + 0.5 > hi) label[y * w + x] = -1
    }
    return label
  }

  /** Pixels on long straight dark lines (panel borders): vertical = runs down a column. The dark mask
   *  is widened across the run by 2 px, so a slightly slanted border still gives one long run. */
  internal fun frameRuns(light: BooleanArray, w: Int, h: Int, minLen: Int, vertical: Boolean): BooleanArray {
    val dark = BooleanArray(w * h) { i ->
      val x = i % w; val y = i / w
      var d = false
      for (k in -2..2) {
        val xx = if (vertical) x + k else x; val yy = if (vertical) y else y + k
        if (xx in 0 until w && yy in 0 until h && !light[yy * w + xx]) { d = true; break }
      }
      d
    }
    val out = BooleanArray(w * h)
    val lines = if (vertical) w else h
    val len = if (vertical) h else w
    for (a in 0 until lines) {
      var b = 0
      while (b < len) {
        val i0 = if (vertical) b * w + a else a * w + b
        if (!dark[i0]) { b++; continue }
        var e = b
        while (e < len && dark[if (vertical) e * w + a else a * w + e]) e++
        if (e - b >= minLen) for (k in b until e) {
          val i = if (vertical) k * w + a else a * w + k
          if (!light[i]) out[i] = true
        }
        b = e
      }
    }
    return out
  }

  private class Cutter(
    val light: BooleanArray, val w: Int, val h: Int, val label: IntArray,
    /** on a vertical border: such a pixel on a row means the row runs through a panel, not along a gutter */
    val vFrame: BooleanArray, val hFrame: BooleanArray,
  ) {
    var nextId = 1

    fun split(id: Int, bb: IntArray, horizontal: Boolean, depth: Int, minGap: Int, out: MutableList<IntArray>, triedOther: Boolean = false) {
      val (x0, y0, x1, y1) = bb.let { listOf(it[0], it[1], it[2], it[3]) }
      if (x1 - x0 < 12 || y1 - y0 < 12) return
      val xm = (x0 + x1) / 2.0; val ym = (y0 + y1) / 2.0
      val across = if (horizontal) x1 - x0 else y1 - y0
      var bestRuns: List<IntArray>? = null; var bestGut = -1; var bestT = 0.0; var bestOff = 0
      // gutter lines may be slanted by up to ~3 degrees (tan 0.05)
      for (t in doubleArrayOf(0.0, -0.0125, 0.0125, -0.025, 0.025, -0.0375, 0.0375, -0.05, 0.05)) {
        val off = (abs(t) * across / 2).toInt() + 1
        val n = (if (horizontal) y1 - y0 else x1 - x0) + 2 * off + 1
        val cnt = IntArray(n); val lit = IntArray(n); val frame = IntArray(n)
        for (y in y0 until y1) for (x in x0 until x1) {
          val i = y * w + x
          if (label[i] != id) continue
          val o = (if (horizontal) y - y0 - t * (x - xm) else x - x0 - t * (y - ym)).roundToInt() + off
          cnt[o]++
          if (light[i]) lit[o]++
          if (if (horizontal) vFrame[i] else hFrame[i]) frame[o]++
        }
        val gutter = BooleanArray(n) { cnt[it] == 0 || (lit[it] >= cnt[it] * 0.93 && frame[it] == 0) }
        val runs = runsOf(gutter, minGap)
        val gut = gutter.count { it }
        val better = bestRuns == null || runs.size > bestRuns.size || (runs.size == bestRuns.size && gut > bestGut)
        if (better) { bestRuns = runs; bestGut = gut; bestT = t; bestOff = off }
      }
      val runs = bestRuns ?: return
      if (runs.isEmpty()) return
      // relabel: every content run becomes a region, gutter pixels leave
      val n = (if (horizontal) y1 - y0 else x1 - x0) + 2 * bestOff + 1
      val runOf = IntArray(n) { -1 }
      val ids = IntArray(runs.size) { nextId++ }
      runs.forEachIndexed { k, r -> for (o in r[0] until r[1]) runOf[o] = ids[k] }
      for (y in y0 until y1) for (x in x0 until x1) {
        val i = y * w + x
        if (label[i] != id) continue
        val o = (if (horizontal) y - y0 - bestT * (x - xm) else x - x0 - bestT * (y - ym)).roundToInt() + bestOff
        label[i] = runOf[o]
      }
      val boxes = ids.map { contentBox(it, bb) }
      if (runs.size > 1 && depth < 8) {
        ids.forEachIndexed { k, rid -> boxes[k]?.let { split(rid, it, !horizontal, depth + 1, minGap, out) } }
      } else if (!triedOther && depth < 8) {
        boxes[0]?.let { split(ids[0], it, !horizontal, depth, minGap, out, triedOther = true) }
      } else {
        boxes[0]?.let { out.add(it) }
      }
    }

    private fun runsOf(gutter: BooleanArray, minGap: Int): List<IntArray> {
      // content runs; gaps shorter than minGap (text lines, thin artwork) do not split
      val runs = mutableListOf<IntArray>()
      var start = -1; var end = -1
      for (i in gutter.indices) {
        if (!gutter[i]) { if (start < 0) start = i; end = i + 1 }
        else if (start >= 0 && i - end + 1 >= minGap) { if (end - start >= 6) runs.add(intArrayOf(start, end)); start = -1 }
      }
      if (start >= 0 && end - start >= 6) runs.add(intArrayOf(start, end))
      return runs
    }

    /** Bounding box of the region's ink, ignoring rows/columns with only a stray dark pixel or two. */
    private fun contentBox(id: Int, bb: IntArray): IntArray? {
      val rows = IntArray(bb[3] - bb[1]); val cols = IntArray(bb[2] - bb[0])
      for (y in bb[1] until bb[3]) for (x in bb[0] until bb[2]) {
        val i = y * w + x
        if (label[i] == id && !light[i]) { rows[y - bb[1]]++; cols[x - bb[0]]++ }
      }
      val ry0 = rows.indexOfFirst { it >= 2 }; val ry1 = rows.indexOfLast { it >= 2 }
      val rx0 = cols.indexOfFirst { it >= 2 }; val rx1 = cols.indexOfLast { it >= 2 }
      if (ry0 < 0 || rx0 < 0) return null
      return intArrayOf(bb[0] + rx0, bb[1] + ry0, bb[0] + rx1 + 1, bb[1] + ry1 + 1)
    }
  }

  /** Degrees the photo is tilted by; rotating the photo by minus this value makes the panels straight. */
  fun skewOf(lum: IntArray, w: Int, h: Int): Double = if (w < 8 || h < 8) 0.0 else skew(lightMap(lum, w, h), w, h)

  /** Paper = brighter than (local paper level - 40). The local level is the 90th percentile of the
   *  surrounding cells, so a shadow over half of the page does not turn the paper "dark". */
  internal fun lightMap(lum: IntArray, w: Int, h: Int): BooleanArray {
    val global = percentile(lum, 0.92)
    val cell = max(8, max(w, h) / 12)
    val cw = (w + cell - 1) / cell
    val ch = (h + cell - 1) / cell
    val level = IntArray(cw * ch)
    val buf = IntArray(cell * cell)
    for (cy in 0 until ch) for (cx in 0 until cw) {
      var n = 0
      for (y in cy * cell until min(h, (cy + 1) * cell)) for (x in cx * cell until min(w, (cx + 1) * cell)) buf[n++] = lum[y * w + x]
      level[cy * cw + cx] = percentile(buf.copyOf(n), 0.9)
    }
    // a cell full of artwork borrows the paper level of its neighbours
    val paper = IntArray(cw * ch) { i ->
      val cx = i % cw; val cy = i / cw
      var m = 0
      for (dy in -1..1) for (dx in -1..1) {
        val x = cx + dx; val y = cy + dy
        if (x in 0 until cw && y in 0 until ch) m = max(m, level[y * cw + x])
      }
      max(m, global - 60)
    }
    return BooleanArray(w * h) { i ->
      val x = i % w; val y = i / w
      lum[i] >= paper[(y / cell) * cw + x / cell] - 40
    }
  }

  /** The rotation (degrees) that makes rows and columns most "all paper or not": straight gutters
   *  give many fully light lines. Searched on a small copy; 0 unless another angle is clearly better. */
  internal fun skew(light: BooleanArray, w: Int, h: Int): Double {
    val k = max(1, max(w, h) / 360)
    val sw = w / k; val sh = h / k
    val small = BooleanArray(sw * sh) { i -> light[(i / sw) * k * w + (i % sw) * k] }
    fun score(a: Double): Double {
      val rad = Math.toRadians(a); val c = cos(rad); val s = sin(rad)
      val cx = sw / 2.0; val cy = sh / 2.0
      val rowL = IntArray(sh); val rowN = IntArray(sh); val colL = IntArray(sw); val colN = IntArray(sw)
      for (y in 0 until sh) for (x in 0 until sw) {
        val sx = (c * (x - cx) - s * (y - cy) + cx).roundToInt()
        val sy = (s * (x - cx) + c * (y - cy) + cy).roundToInt()
        if (sx !in 0 until sw || sy !in 0 until sh) continue
        rowN[y]++; colN[x]++
        if (small[sy * sw + sx]) { rowL[y]++; colL[x]++ }
      }
      var sc = 0.0
      for (y in 0 until sh) if (rowN[y] > sw / 2) { val r = rowL[y].toDouble() / rowN[y]; sc += r * r * r * r * r * r * r * r }
      for (x in 0 until sw) if (colN[x] > sh / 2) { val r = colL[x].toDouble() / colN[x]; sc += r * r * r * r * r * r * r * r }
      return sc
    }
    val base = score(0.0)
    var best = 0.0; var bestScore = base
    var a = -4.0
    while (a <= 4.0001) {
      if (abs(a) > 1e-6) { val sc = score(a); if (sc > bestScore) { bestScore = sc; best = a } }
      a += 0.5
    }
    return if (bestScore > base * 1.03 + 1) best else 0.0
  }

  /** The light map turned by -angle (so the page becomes straight); outside the photo counts as paper. */
  internal fun rotate(light: BooleanArray, w: Int, h: Int, angle: Double): BooleanArray {
    val rad = Math.toRadians(angle); val c = cos(rad); val s = sin(rad)
    val cx = w / 2.0; val cy = h / 2.0
    return BooleanArray(w * h) { i ->
      val x = i % w; val y = i / w
      val sx = (c * (x - cx) - s * (y - cy) + cx).roundToInt()
      val sy = (s * (x - cx) + c * (y - cy) + cy).roundToInt()
      if (sx !in 0 until w || sy !in 0 until h) true else light[sy * w + sx]
    }
  }

  /** A box found on the straightened map, as the bounding box of its corners on the original photo. */
  private fun unrotate(b: IntArray, w: Int, h: Int, angle: Double): IntArray {
    val rad = Math.toRadians(angle); val c = cos(rad); val s = sin(rad)
    val cx = w / 2.0; val cy = h / 2.0
    var x0 = Double.MAX_VALUE; var y0 = Double.MAX_VALUE; var x1 = -Double.MAX_VALUE; var y1 = -Double.MAX_VALUE
    for ((x, y) in listOf(b[0] to b[1], b[2] to b[1], b[0] to b[3], b[2] to b[3])) {
      val sx = c * (x - cx) - s * (y - cy) + cx
      val sy = s * (x - cx) + c * (y - cy) + cy
      x0 = min(x0, sx); y0 = min(y0, sy); x1 = max(x1, sx); y1 = max(y1, sy)
    }
    return intArrayOf(
      x0.roundToInt().coerceIn(0, w - 1), y0.roundToInt().coerceIn(0, h - 1),
      x1.roundToInt().coerceIn(1, w), y1.roundToInt().coerceIn(1, h),
    )
  }

  private fun percentile(a: IntArray, p: Double): Int {
    if (a.isEmpty()) return 255
    val hist = IntArray(256)
    for (v in a) hist[v.coerceIn(0, 255)]++
    val target = (a.size * p).toLong()
    var acc = 0L
    for (v in 0..255) { acc += hist[v]; if (acc >= target) return v }
    return 255
  }
}
