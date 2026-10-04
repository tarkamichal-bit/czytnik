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
  /** Returns panels as [x0, y0, x1, y1] (x1/y1 exclusive) in the input's pixel space. */
  fun cut(lum: IntArray, w: Int, h: Int): List<IntArray> {
    if (w < 8 || h < 8) return listOf(intArrayOf(0, 0, w, h))
    val light0 = lightMap(lum, w, h)
    val angle = skew(light0, w, h)
    val light = if (angle == 0.0) light0 else rotate(light0, w, h, angle)

    // The photo usually shows some table around the page: keep the span where rows/cols are mostly paper.
    val page = pageBox(light, w, h)
    val out = mutableListOf<IntArray>()
    val minGap = max(3, (max(w, h) * 0.006).toInt())
    split(light, w, page[0], page[1], page[2], page[3], horizontal = true, depth = 0, minGap = minGap, out = out)

    val pageArea = (page[2] - page[0]).toLong() * (page[3] - page[1])
    val kept = out.filter { (it[2] - it[0]).toLong() * (it[3] - it[1]) >= pageArea * 0.02 }
    val boxes = if (kept.isEmpty()) listOf(page) else kept
    return if (angle == 0.0) boxes else boxes.map { unrotate(it, w, h, angle) }
  }

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

  private fun pageBox(light: BooleanArray, w: Int, h: Int): IntArray {
    fun rowRatio(y: Int): Double { var c = 0; for (x in 0 until w) if (light[y * w + x]) c++; return c.toDouble() / w }
    fun colRatio(x: Int): Double { var c = 0; for (y in 0 until h) if (light[y * w + x]) c++; return c.toDouble() / h }
    var y0 = 0; while (y0 < h - 1 && rowRatio(y0) < 0.5) y0++
    var y1 = h; while (y1 > y0 + 1 && rowRatio(y1 - 1) < 0.5) y1--
    var x0 = 0; while (x0 < w - 1 && colRatio(x0) < 0.5) x0++
    var x1 = w; while (x1 > x0 + 1 && colRatio(x1 - 1) < 0.5) x1--
    return if ((x1 - x0) * 3 < w || (y1 - y0) * 3 < h) intArrayOf(0, 0, w, h) else intArrayOf(x0, y0, x1, y1)
  }

  private fun split(
    light: BooleanArray, w: Int, x0: Int, y0: Int, x1: Int, y1: Int,
    horizontal: Boolean, depth: Int, minGap: Int, out: MutableList<IntArray>, triedOther: Boolean = false,
  ) {
    if (x1 - x0 < 12 || y1 - y0 < 12) return
    // gutter line: at least 93% of its pixels are paper (a stray hair or a bubble tail may cross it)
    val n = if (horizontal) y1 - y0 else x1 - x0
    val gutter = BooleanArray(n) { i ->
      var c = 0
      if (horizontal) { val y = y0 + i; for (x in x0 until x1) if (light[y * w + x]) c++; c >= (x1 - x0) * 0.93 }
      else { val x = x0 + i; for (y in y0 until y1) if (light[y * w + x]) c++; c >= (y1 - y0) * 0.93 }
    }
    // content runs; gaps shorter than minGap (text lines, thin artwork) do not split
    val runs = mutableListOf<IntArray>()
    var start = -1
    var end = -1
    for (i in 0 until n) {
      if (!gutter[i]) { if (start < 0) start = i; end = i + 1 }
      else if (start >= 0 && i - end + 1 >= minGap) { if (end - start >= 6) runs.add(intArrayOf(start, end)); start = -1 }
    }
    if (start >= 0 && end - start >= 6) runs.add(intArrayOf(start, end))
    if (runs.isEmpty()) return
    val trimmed = if (horizontal) intArrayOf(x0, y0 + runs.first()[0], x1, y0 + runs.last()[1])
                  else intArrayOf(x0 + runs.first()[0], y0, x0 + runs.last()[1], y1)
    if (runs.size > 1 && depth < 8) {
      for (r in runs) {
        if (horizontal) split(light, w, x0, y0 + r[0], x1, y0 + r[1], false, depth + 1, minGap, out)
        else split(light, w, x0 + r[0], y0, x0 + r[1], y1, true, depth + 1, minGap, out)
      }
    } else if (!triedOther && depth < 8) {
      split(light, w, trimmed[0], trimmed[1], trimmed[2], trimmed[3], !horizontal, depth, minGap, out, triedOther = true)
    } else {
      out.add(trimmed)
    }
  }
}
