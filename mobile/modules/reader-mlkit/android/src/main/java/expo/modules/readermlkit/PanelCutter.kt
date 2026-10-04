package expo.modules.readermlkit

import kotlin.math.max

/**
 * Finds comic panels in a grayscale page photo with a recursive XY-cut: the page is split along
 * light gutters (rows/columns that are almost entirely paper), first into horizontal strips, then
 * each strip into columns, and so on. The output order is the Western reading order
 * (top to bottom, left to right). Pure Kotlin, no Android types, so it can be unit-tested on the JVM.
 */
object PanelCutter {
  /** Returns panels as [x0, y0, x1, y1] (x1/y1 exclusive) in the input's pixel space. */
  fun cut(lum: IntArray, w: Int, h: Int): List<IntArray> {
    if (w < 8 || h < 8) return listOf(intArrayOf(0, 0, w, h))
    val paper = percentile(lum, 0.92)
    val light = BooleanArray(lum.size) { lum[it] >= paper - 40 }

    // The photo usually shows some table around the page: keep the span where rows/cols are mostly paper.
    val page = pageBox(light, w, h)
    val out = mutableListOf<IntArray>()
    val minGap = max(3, (max(w, h) * 0.006).toInt())
    split(light, w, page[0], page[1], page[2], page[3], horizontal = true, depth = 0, minGap = minGap, out = out)

    val pageArea = (page[2] - page[0]).toLong() * (page[3] - page[1])
    val kept = out.filter { (it[2] - it[0]).toLong() * (it[3] - it[1]) >= pageArea * 0.02 }
    return if (kept.isEmpty()) listOf(page) else kept
  }

  private fun percentile(a: IntArray, p: Double): Int {
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
    // gutter line: at least 95% of its pixels are paper
    val n = if (horizontal) y1 - y0 else x1 - x0
    val gutter = BooleanArray(n) { i ->
      var c = 0
      if (horizontal) { val y = y0 + i; for (x in x0 until x1) if (light[y * w + x]) c++; c >= (x1 - x0) * 0.95 }
      else { val x = x0 + i; for (y in y0 until y1) if (light[y * w + x]) c++; c >= (y1 - y0) * 0.95 }
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
